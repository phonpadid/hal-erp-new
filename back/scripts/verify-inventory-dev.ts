import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { RequestContext as OrmContext } from '@mikro-orm/core';
import { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { AppModule } from '../src/app.module';
import { RequestContext } from '../src/common/context/request-context';
import { DocStatus, Scope, StockTxnType } from '../src/common/enums';
import { PermissionResolverService } from '../src/modules/rbac/permission-resolver.service';
import { DocumentService } from '../src/modules/document/document.service';
import { DocumentSubmitService } from '../src/modules/document/document-submit.service';
import { ApprovalRoutingService } from '../src/modules/approval/approval-routing.service';
import { StockBalanceService } from '../src/modules/inventory/stock-balance.service';
import { Warehouse, StockBalance, StockTxn } from '../src/modules/inventory/inventory.entities';
import { Document, DocumentType, FormField, FormTemplate } from '../src/modules/document/document.entities';
import { Item } from '../src/modules/master-data/master-data.entities';
import { JournalEntry, JournalLine } from '../src/modules/gl/gl.entities';
import { Company, Department } from '../src/modules/multi-company/multi-company.entities';
import { AppUser } from '../src/modules/rbac/rbac.entities';

/**
 * Drive the three stock movements end to end on a NON-PRODUCTION database, through the real
 * services — `createDraft`, `submit`, `act` — so the configuration that `setup-inventory-dev.ts`
 * wrote is exercised the way the screens exercise it, not simulated.
 *
 * What it proves, in order: an opening count puts stock on the shelf and values it; an issue
 * RESERVES at submit without moving on-hand and converts to ISSUE at full approval; a transfer
 * writes the paired rows; and a recompute from `stock_txn` alone reproduces every balance
 * (invariant 3). The GL is reported rather than asserted — it posts after the commit, so a
 * missing account role shows up here as an absence, which is the point.
 *
 * It WRITES: three documents, their numbers, and the stock ledger rows they cause. That makes it a
 * local-only tool. `stock_txn` is append-only (invariant 2), so a re-run adds to the shelf rather
 * than resetting it — the assertions are written as deltas for that reason.
 */

const COMPANY_CODE = process.env.ERP_COMPANY ?? 'HAL';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const out: string[] = [];
  const fail: string[] = [];
  const log = (s: string): void => {
    // eslint-disable-next-line no-console
    console.log(s);
  };

  try {
    const orm = app.get(MikroORM);
    const em = orm.em.fork() as EntityManager;
    const OFF = { filters: { company: false } } as const;

    const company = await em.findOneOrFail(Company, { code: COMPANY_CODE }, OFF);
    const dept = await em.findOneOrFail(Department, { company, deptCode: 'ADM' }, OFF);
    const main = await em.findOneOrFail(Warehouse, { company, code: 'MAIN' }, OFF);
    const sort = await em.findOneOrFail(Warehouse, { company, code: 'SORT' }, OFF);
    const box = await em.findOneOrFail(Item, { itemCode: 'STK-BOX' }, OFF);

    // The requester and the approver must be different people: a user cannot approve what they
    // created, directly or by delegation (invariant 8). Both need a signature on file, because
    // submit and approve have each demanded one since the signature gate shipped.
    const requester = await em.findOneOrFail(AppUser, { username: 'Poupay' }, OFF);
    const approverUser = await em.findOneOrFail(AppUser, { username: 'Thipkhounheuane' }, OFF);

    const resolver = app.get(PermissionResolverService);
    const docs = app.get(DocumentService);
    const submits = app.get(DocumentSubmitService);
    const routing = app.get(ApprovalRoutingService);
    const balances = app.get(StockBalanceService);

    // Real resolved authority, not a hand-written list: the point is to run with exactly what the
    // login would hand these two users, including the home department and the department set a
    // DEPARTMENT-scoped read filters on.
    const contextFor = async (user: AppUser, extraCodes: string[] = []) => {
      const rbac = await resolver.resolve(user.id, company.id);
      if (!rbac) throw new Error(`${user.username} holds no active role in ${COMPANY_CODE}`);
      const extra = extraCodes
        .filter((code) => !rbac.grants.some((g) => g.code === code))
        .map((code) => ({ code, scope: Scope.DEPARTMENT }));
      return {
        userId: user.id,
        companyId: company.id,
        departmentId: dept.id,
        departmentIds: [...new Set([...rbac.departmentIds, dept.id])],
        grants: [...rbac.grants, ...extra],
      };
    };
    // Two contexts, both required: ours carries WHO is acting, MikroORM's carries the EntityManager
    // the services resolve per request. Outside an HTTP request neither exists, and a service that
    // forks off the global instance is refused rather than quietly sharing an identity map.
    const asUser = async <T>(user: AppUser, cb: () => Promise<T>): Promise<T> =>
      RequestContext.run(await contextFor(user), () => OrmContext.create(orm.em, cb));
    // The requester here is STAFF, so they do not hold the inventory codes a stock officer would.
    // Lending them for this run keeps the script asserting on the STOCK outcome; the controller
    // guard is what enforces the code on a real request, and `INV_OFFICER` is the role that
    // carries them in production.
    const withInventoryCodes = async <T>(user: AppUser, cb: () => Promise<T>): Promise<T> =>
      RequestContext.run(
        await contextFor(user, [
          'INV_VIEW', 'INV_ISSUE', 'INV_ADJUST', 'INV_TRANSFER',
          'DOC_CREATE', 'DOC_SUBMIT', 'DOC_VIEW',
        ]),
        () => OrmContext.create(orm.em, cb),
      );

    const fieldsOf = async (code: string): Promise<FormField[]> => {
      const type = await em.findOneOrFail(DocumentType, { company, code }, OFF);
      const template = (await em.find(FormTemplate, { documentType: type }, { ...OFF, orderBy: { version: 'DESC' } }))[0];
      return em.find(FormField, { formTemplate: template }, { ...OFF, orderBy: { sortOrder: 'ASC' } });
    };
    const typeId = async (code: string): Promise<string> =>
      (await em.findOneOrFail(DocumentType, { company, code }, OFF)).id;

    const balanceOf = async (itemId: string, warehouseId: string): Promise<{ onHand: string; reserved: string; avg: string }> => {
      const fresh = orm.em.fork();
      const row = await fresh.findOne(StockBalance, { company: company.id, item: itemId, warehouse: warehouseId }, OFF);
      return {
        onHand: row?.qtyOnHand ?? '0',
        reserved: row?.qtyReserved ?? '0',
        avg: row?.avgCost ?? '0',
      };
    };
    const n = (s: string): number => Number(s);
    const check = (what: string, got: unknown, want: unknown): void => {
      const ok = String(got) === String(want);
      (ok ? out : fail).push(`${ok ? 'OK  ' : 'FAIL'} ${what}: ${String(got)}${ok ? '' : ` (expected ${String(want)})`}`);
    };

    const before = await balanceOf(box.id, main.id);
    log(`start   STK-BOX in MAIN: on_hand=${before.onHand} reserved=${before.reserved} avg=${before.avg}\n`);

    // --- 1. the opening count ---------------------------------------------------------------
    // ADJUST_STOCK reads direction from the sign of the line quantity and takes an increase's cost
    // from the line, which is what lets a count into an EMPTY warehouse carry a value at all.
    const adjFields = await fieldsOf('STK_ADJ');
    const adjDoc = await withInventoryCodes(requester, async () => {
      const draft = await docs.createDraft({
        documentTypeId: await typeId('STK_ADJ'),
        warehouseId: main.id,
        fieldValues: [
          { formFieldId: adjFields[0]!.id, value: 'COUNT-2026-10-05' },
          { formFieldId: adjFields[1]!.id, value: 'OPENING' },
        ],
        lines: [{
          lineNo: 1, itemId: box.id, description: 'ຍອດຍົກມາ ກ່ອງພັດສະດຸ',
          qty: '100', unit: 'ໜ່ວຍ', unitPrice: '5000', lineAmount: '500000',
        }],
      });
      await submits.submit(draft.id);
      return draft;
    });
    await asUser(approverUser, () => routing.act(adjDoc.id, { action: 'APPROVE' } as never));

    const afterOpening = await balanceOf(box.id, main.id);
    check('opening count on_hand', n(afterOpening.onHand) - n(before.onHand), 100);
    check('opening count avg_cost', afterOpening.avg, '5000.000000');

    // --- 2. the issue -----------------------------------------------------------------------
    const issueFields = await fieldsOf('STK_ISSUE');
    const issueDoc = await withInventoryCodes(requester, async () => {
      const draft = await docs.createDraft({
        documentTypeId: await typeId('STK_ISSUE'),
        warehouseId: main.id,
        fieldValues: [
          { formFieldId: issueFields[0]!.id, value: 'ຫໍ່ພັດສະດຸປະຈຳວັນ' },
          { formFieldId: issueFields[1]!.id, value: 'ພະແນກບໍລິຫານ' },
        ],
        lines: [{
          lineNo: 1, itemId: box.id, description: 'ເບີກກ່ອງພັດສະດຸ',
          qty: '30', unit: 'ໜ່ວຍ', unitPrice: '5000', lineAmount: '150000',
        }],
      });
      await submits.submit(draft.id);
      return draft;
    });

    // Availability is enforced at SUBMIT, where the reservation is taken — a shortage belongs in
    // front of the requester, not in front of the last approver.
    const atSubmit = await balanceOf(box.id, main.id);
    check('issue submit: on_hand unchanged', atSubmit.onHand, afterOpening.onHand);
    check('issue submit: reserved', n(atSubmit.reserved) - n(afterOpening.reserved), 30);

    await asUser(approverUser, () => routing.act(issueDoc.id, { action: 'APPROVE' } as never));
    const afterIssue = await balanceOf(box.id, main.id);
    check('issue approved: on_hand', n(afterOpening.onHand) - n(afterIssue.onHand), 30);
    check('issue approved: reservation discharged', n(atSubmit.reserved) - n(afterIssue.reserved), 30);
    check('issue approved: avg_cost unmoved', afterIssue.avg, afterOpening.avg);

    // --- 3. the transfer --------------------------------------------------------------------
    const sortBefore = await balanceOf(box.id, sort.id);
    const xferFields = await fieldsOf('STK_XFER');
    const xferDoc = await withInventoryCodes(requester, async () => {
      const draft = await docs.createDraft({
        documentTypeId: await typeId('STK_XFER'),
        warehouseId: main.id,
        destWarehouseId: sort.id,
        fieldValues: [{ formFieldId: xferFields[0]!.id, value: 'ຕຸນໄວ້ສູນຄັດແຍກ' }],
        lines: [{
          lineNo: 1, itemId: box.id, description: 'ໂອນກ່ອງພັດສະດຸ',
          qty: '20', unit: 'ໜ່ວຍ', unitPrice: '5000', lineAmount: '100000',
        }],
      });
      await submits.submit(draft.id);
      return draft;
    });
    await asUser(approverUser, () => routing.act(xferDoc.id, { action: 'APPROVE' } as never));

    const mainAfterXfer = await balanceOf(box.id, main.id);
    const sortAfterXfer = await balanceOf(box.id, sort.id);
    check('transfer: MAIN down', n(afterIssue.onHand) - n(mainAfterXfer.onHand), 20);
    check('transfer: SORT up', n(sortAfterXfer.onHand) - n(sortBefore.onHand), 20);
    check('transfer: SORT valued at the cost that left', sortAfterXfer.avg, '5000.000000');

    // --- 4. the ledger is the truth ---------------------------------------------------------
    // A balance that cannot be rebuilt from its ledger is a number somebody authored. The repair
    // path and the invariant are the same operation.
    for (const [label, wh] of [['MAIN', main], ['SORT', sort]] as const) {
      const stored = await balanceOf(box.id, wh.id);
      const rebuilt = await RequestContext.run(
        { userId: approverUser.id, companyId: company.id, departmentId: dept.id, grants: [{ code: 'INV_MANAGE', scope: Scope.COMPANY }] },
        () => balances.recompute(box.id, wh.id),
      );
      check(`${label} replays from stock_txn`, `${rebuilt.qtyOnHand}/${rebuilt.qtyReserved}`, `${stored.onHand}/${stored.reserved}`);
    }

    // --- 5. what the ledger and the GL actually recorded ------------------------------------
    const fresh = orm.em.fork();
    const docIds = [adjDoc.id, issueDoc.id, xferDoc.id];
    const txns = await fresh.find(StockTxn, { company: company.id, document: { $in: docIds } }, { ...OFF, populate: ['warehouse'], orderBy: { createdAt: 'ASC' } });
    const statuses = await Promise.all(docIds.map(async (id) => {
      const d = await fresh.findOne(Document, { id }, OFF);
      return `${d?.docNo} ${d?.status}`;
    }));

    log(out.concat(fail).join('\n'));
    log(`\ndocuments\n  ${statuses.join('\n  ')}`);
    log(`\nstock_txn written (${txns.length})`);
    for (const t of txns) {
      log(`  ${t.txnType.padEnd(16)} ${t.qty.padStart(10)} @ ${t.unitCost ?? '-'}  ${t.warehouse.code}`);
    }
    const entries = await fresh.find(JournalEntry, { company: company.id }, { ...OFF, orderBy: { createdAt: 'DESC' }, limit: 10 });
    log(`\njournal_entry rows for ${COMPANY_CODE}: ${entries.length}`);
    for (const e of entries) {
      const lines = await fresh.find(JournalLine, { journalEntry: e.id }, { ...OFF, populate: ['account'] });
      log(`  ${e.sourceType} ${e.entryDate}`);
      for (const l of lines) log(`     ${l.account.code.padEnd(12)} Dr ${l.debit} Cr ${l.credit}`);
    }

    const allDocsCompleted = statuses.every((s) => s.endsWith(DocStatus.COMPLETED) || s.endsWith(DocStatus.APPROVED));
    if (!allDocsCompleted) fail.push(`FAIL not every document finished its route: ${statuses.join(' | ')}`);

    log(fail.length ? `\n${fail.length} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
    if (fail.length) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('verify-inventory-dev FAILED:', error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContext } from '../../common/context/request-context';
import { AccountRoleType, DocStatus, StockTxnType } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AccountService } from '../accounting/account.service';
import { Account } from '../accounting/accounting.entities';
import { Workflow } from '../approval/approval.entities';
import {
  DeptDocType,
  Document,
  DocumentLine,
  DocumentType,
  FormTemplate,
} from '../document/document.entities';
import { ReceivingService } from '../document/receiving.service';
import { StockTxn } from '../inventory/inventory.entities';
import { StockBalanceService } from '../inventory/stock-balance.service';
import { StockLedgerService } from '../inventory/stock-ledger.service';
import { WarehouseService } from '../inventory/warehouse.service';
import { Item, ItemCompany } from '../master-data/master-data.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { AccountRoleService } from './account-role.service';
import { GlPostingService } from './gl-posting.service';
import { GlPostingListener } from './gl-posting.listener';
import { AccountRole, JournalEntry, JournalLine } from './gl.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('perpetual GL posting for stock movements (DB-backed)', () => {
  let orm: MikroORM;
  let posting: GlPostingService;
  let balances: StockBalanceService;
  let ledger: StockLedgerService;
  let companyA = '';
  let itemId = '';
  let whId = '';

  const asCompanyA = <T>(fn: () => T): T =>
    RequestContext.run({ userId: undefined, companyId: companyA, grants: [] }, fn);

  /** Record a movement and return its stock_txn id. */
  const move = (txnType: StockTxnType, qty: string, unitCost?: string): Promise<string> =>
    asCompanyA(() =>
      balances.transactional(async (tem) => {
        const locked = await balances.lockPairs(tem, [{ itemId, warehouseId: whId }]);
        const balance = locked.get(`${itemId}:${whId}`)!;
        const cost = balances.applyMovement(balance, txnType, qty, unitCost);
        const txn = ledger.record(tem, {
          itemId,
          warehouseId: whId,
          txnType,
          qty,
          unitCost: cost,
        });
        await tem.flush();
        return txn.id;
      }),
    );

  const entryFor = async (stockTxnId: string) => {
    const em = orm.em.fork();
    const entry = await em.findOne(
      JournalEntry,
      { sourceType: 'STOCK_TXN', sourceId: stockTxnId },
      FILTER_OFF,
    );
    if (!entry) return null;
    const lines = await em.find(
      JournalLine,
      { journalEntry: entry.id },
      { populate: ['account'], ...FILTER_OFF },
    );
    return { entry, lines };
  };

  /** Map a role to an existing postable account of the seeded company. */
  async function mapRole(role: AccountRoleType, code: string) {
    const em = orm.em.fork();
    const account = await em.findOneOrFail(Account, { company: companyA, code }, FILTER_OFF);
    const existing = await em.findOne(AccountRole, { company: companyA, role }, FILTER_OFF);
    if (existing) {
      existing.account = account;
    } else {
      em.create(AccountRole, {
        company: em.getReference(Company, companyA),
        role,
        account,
      });
    }
    await em.flush();
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());

    const scope = new CompanyScopeService(orm.em);
    balances = new StockBalanceService(scope);
    ledger = new StockLedgerService(scope);
    posting = new GlPostingService(
      orm.em,
      new AccountRoleService(orm.em),
      new AccountService(orm.em, scope),
    );

    const em = orm.em.fork();
    companyA = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;

    // Reuse seeded postable accounts rather than inventing a chart: whichever codes exist, the
    // roles simply have to resolve to active postable accounts.
    const postables = await em.find(
      Account,
      { company: companyA, isActive: true, isPostable: true },
      { ...FILTER_OFF, orderBy: { code: 'ASC' } },
    );
    expect(postables.length).toBeGreaterThanOrEqual(3);

    const item = em.create(Item, {
      itemCode: 'GLI',
      name: 'GL item',
      isStockTracked: true,
      isActive: true,
    });
    em.create(ItemCompany, {
      item,
      company: em.getReference(Company, companyA),
      isActive: true,
      defaultGlAccount: postables[0].code,
    });
    await em.flush();
    itemId = item.id;

    await mapRole(AccountRoleType.INVENTORY, postables[1].code);
    await mapRole(AccountRoleType.GRNI, postables[2].code);
    await mapRole(
      AccountRoleType.INVENTORY_ADJUSTMENT,
      postables[Math.min(3, postables.length - 1)].code,
    );

    whId = (await asCompanyA(() => new WarehouseService(scope).create({ code: 'GL', name: 'GL wh' }))).id;
  });

  afterAll(async () => {
    await orm?.close(true);
  });

  it('debits inventory and credits GRNI on a receipt', async () => {
    const id = await move(StockTxnType.RECEIVE, '10', '120');
    await posting.postForStockTxn(id);

    const posted = await entryFor(id);
    expect(posted).not.toBeNull();
    // Goods are an asset the moment they arrive; GRNI is the promise to pay for them.
    const debit = posted!.lines.find((l) => l.debit !== '0.00');
    const credit = posted!.lines.find((l) => l.credit !== '0.00');
    expect(debit!.debit).toBe('1200.00');
    expect(credit!.credit).toBe('1200.00');
  });

  it('capitalizes a goods receipt taken through ReceivingService', async () => {
    // The receipt path writes its stock_txn outside the approval flow, so it has to announce the
    // movement itself. Without that announcement the payment's GRNI debit never gets its credit
    // and the warehouse's gain never reaches the GL at all.
    const em = orm.em.fork();
    const dept = await em.findOneOrFail(Department, { company: companyA, deptCode: 'PROC' }, FILTER_OFF);
    const poType = await em.findOneOrFail(DocumentType, { code: 'PO' }, FILTER_OFF);
    const mapping = await em.findOneOrFail(
      DeptDocType,
      { department: dept.id, documentType: poType.id },
      { ...FILTER_OFF, populate: ['formTemplate', 'workflow'] },
    );
    const buyer = await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF);
    const doc = em.create(Document, {
      docNo: 'PO-RCV-GL-1',
      company: em.getReference(Company, companyA),
      department: dept,
      documentType: poType,
      formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id),
      createdBy: buyer,
      exchangeRate: '1',
      status: DocStatus.APPROVED,
      createdAt: new Date(),
    });
    const line = em.create(DocumentLine, {
      document: doc,
      lineNo: 1,
      item: em.getReference(Item, itemId),
      description: 'Tracked goods',
      qty: '10',
      unitPrice: '120',
      lineAmount: '1200',
      budgetBaseLineAmount: '1200',
    });
    await em.flush();

    // Wire the listener by hand: @OnEvent only subscribes under Nest's EventEmitterModule.
    const emitter = new EventEmitter2();
    const listener = new GlPostingListener(posting);
    let posted: Promise<void> = Promise.resolve();
    emitter.on('stock.moved', (e: { stockTxnIds: string[] }) => {
      posted = listener.onStockMoved(e);
    });
    const scope = new CompanyScopeService(orm.em);
    const receiving = new ReceivingService(
      scope,
      balances,
      ledger,
      new WarehouseService(scope),
      emitter,
    );

    await RequestContext.run({ userId: buyer.id, companyId: companyA, departmentId: dept.id, grants: [] }, () =>
      receiving.receive(doc.id, { lines: [{ lineId: line.id, qty: '10' }], warehouseId: whId }),
    );
    await posted;

    const txn = await orm.em.fork().findOneOrFail(
      StockTxn,
      { documentLine: line.id, txnType: StockTxnType.RECEIVE },
      FILTER_OFF,
    );
    const entry = await entryFor(txn.id);
    expect(entry).not.toBeNull();
    expect(entry!.lines.find((l) => l.debit !== '0.00')!.debit).toBe('1200.00'); // INVENTORY
    expect(entry!.lines.find((l) => l.credit !== '0.00')!.credit).toBe('1200.00'); // GRNI
  });

  it('expenses the item and credits inventory on an issue', async () => {
    const id = await move(StockTxnType.ISSUE, '4');
    await posting.postForStockTxn(id);

    const posted = await entryFor(id);
    const debit = posted!.lines.find((l) => l.debit !== '0.00')!;
    const credit = posted!.lines.find((l) => l.credit !== '0.00')!;
    // 4 @ the prevailing average of 120.
    expect(debit.debit).toBe('480.00');
    expect(credit.credit).toBe('480.00');

    // The debit is the item's per-company GL — the one place a stock purchase becomes an expense.
    // Resolved by id rather than read off the populated relation: a populated reference in this
    // codebase can come back as an unloaded stub whose fields read undefined.
    const em = orm.em.fork();
    const enablement = await em.findOneOrFail(
      ItemCompany,
      { item: itemId, company: companyA },
      FILTER_OFF,
    );
    const debitAccount = await em.findOneOrFail(Account, { id: debit.account.id }, FILTER_OFF);
    expect(debitAccount.code).toBe(enablement.defaultGlAccount);
  });

  it('posts an adjustment against the adjustment account, in both directions', async () => {
    const up = await move(StockTxnType.ADJUST_INCREASE, '2', '120');
    await posting.postForStockTxn(up);
    const upEntry = await entryFor(up);
    expect(upEntry!.lines.find((l) => l.debit !== '0.00')!.debit).toBe('240.00');

    const down = await move(StockTxnType.ADJUST_DECREASE, '1');
    await posting.postForStockTxn(down);
    const downEntry = await entryFor(down);
    // The reverse of the increase: adjustment debited, inventory credited.
    expect(downEntry!.lines.find((l) => l.credit !== '0.00')!.credit).toBe('120.00');
  });

  it('keeps every entry balanced', async () => {
    const em = orm.em.fork();
    const entries = await em.find(JournalEntry, { sourceType: 'STOCK_TXN' }, FILTER_OFF);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const lines = await em.find(JournalLine, { journalEntry: entry.id }, FILTER_OFF);
      const debit = lines.reduce((s, l) => s + Number(l.debit), 0);
      const credit = lines.reduce((s, l) => s + Number(l.credit), 0);
      expect(debit).toBeCloseTo(credit, 2);
    }
  });

  it('is idempotent — a retry does not double-post', async () => {
    const id = await move(StockTxnType.RECEIVE, '5', '100');
    await posting.postForStockTxn(id);
    await posting.postForStockTxn(id);

    const em = orm.em.fork();
    const count = await em.count(
      JournalEntry,
      { sourceType: 'STOCK_TXN', sourceId: id },
      FILTER_OFF,
    );
    expect(count).toBe(1);
  });

  it('posts nothing for a reservation or a release', async () => {
    const reserved = await move(StockTxnType.RESERVE, '2');
    const released = await move(StockTxnType.RELEASE, '2');
    await posting.postForStockTxn(reserved);
    await posting.postForStockTxn(released);

    // No value moved, so there is nothing to say in the ledger.
    expect(await entryFor(reserved)).toBeNull();
    expect(await entryFor(released)).toBeNull();
  });

  it('fails only the posting when a role is unmapped, leaving the movement intact', async () => {
    const em = orm.em.fork();
    const mapping = await em.findOneOrFail(
      AccountRole,
      { company: companyA, role: AccountRoleType.INVENTORY },
      FILTER_OFF,
    );
    await em.nativeDelete(AccountRole, { id: mapping.id }, FILTER_OFF);

    const id = await move(StockTxnType.RECEIVE, '3', '100');
    await expect(posting.postForStockTxn(id)).rejects.toThrow(/no active account mapped/i);

    // The movement itself is committed and correct — the GL is merely incomplete, which is the
    // same failure mode payment posting already has.
    const fresh = orm.em.fork();
    const stillThere = await fresh.count(JournalEntry, { sourceType: 'STOCK_TXN', sourceId: id }, FILTER_OFF);
    expect(stillThere).toBe(0);
    const page = await asCompanyA(() => balances.onHand({ itemId, warehouseId: whId }));
    expect(Number(page.items[0].qtyOnHand)).toBeGreaterThan(0);
  });
});

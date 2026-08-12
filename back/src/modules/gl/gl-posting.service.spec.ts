import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccountRoleType, BudgetTxnType, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { DeptDocType, Document, DocumentLine, DocumentType, FormTemplate } from '../document/document.entities';
import { Item, ItemCompany, Vendor } from '../master-data/master-data.entities';
import { Account } from '../accounting/accounting.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Payment } from '../payment-handoff/payment.entities';
import { AppUser } from '../rbac/rbac.entities';
import {seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { AccountService } from '../accounting/account.service';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { AccountRoleService } from './account-role.service';
import { GlPostingService } from './gl-posting.service';
import { AccountRole, JournalEntry } from './gl.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * A payment credits the CLEARING account, not Cash.
 *
 * `CASH_CLEARING` was mapped to `1000 Cash`, so recording a payment credited Cash whether or not
 * the money had left the bank. It now points at `1010 Cash Clearing`, and a second entry moves it
 * to the bank account when the bank confirms — which is what makes the clearing balance the
 * reconciling item. These assertions follow the role, not the account number they used to hit.
 */
const CLEARING = '1010';

describe.skipIf(!hasDb)('GL posting on payment.settled (DB-backed)', () => {
  let orm: MikroORM;
  let posting: GlPostingService;
  let companyId = '';
  let budgetId = '';
  let stockItemId = '';
  let plainItemId = '';
  let grniCode = '';
  let apCode = '';
  let vatCode = '';
  let accruingTypeId = '';
  let vendorId = '';
  let seq = 0;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());
    posting = new GlPostingService(orm.em, new AccountRoleService(orm.em), new AccountService(orm.em, new CompanyScopeService(orm.em)), new PeriodGuardService());

    const em = orm.em.fork();
    companyId = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    budgetId = (await em.findOneOrFail(Budget, { glAccount: '5000' }, { ...FILTER_OFF, populate: ['fiscalYear'] })).id;

    // Two items for the GRNI split: one capitalized into inventory at receipt, one not. Both point
    // at GL 5000 so they resolve to the same budget account and the split is the only difference.
    const stockItem = em.create(Item, { itemCode: 'GRNI-S', name: 'Tracked', isStockTracked: true, isActive: true });
    const plainItem = em.create(Item, { itemCode: 'GRNI-P', name: 'Untracked', isStockTracked: false, isActive: true });
    for (const item of [stockItem, plainItem]) {
      em.create(ItemCompany, {
        item, company: em.getReference(Company, companyId), isActive: true, defaultGlAccount: '5000',
      } as never);
    }
    await em.flush();
    stockItemId = stockItem.id;
    plainItemId = plainItem.id;
    // Read the code off the company's own GRNI mapping rather than assuming one: the seed maps the
    // role, and asserting against a code picked here would test the fixture, not the posting.
    const grniRole = await em.findOneOrFail(
      AccountRole,
      { company: companyId, role: AccountRoleType.GRNI },
      { ...FILTER_OFF, populate: ['account'] },
    );
    grniCode = grniRole.account.code;
    const apRole = await em.findOneOrFail(
      AccountRole,
      { company: companyId, role: AccountRoleType.ACCOUNTS_PAYABLE },
      { ...FILTER_OFF, populate: ['account'] },
    );
    apCode = apRole.account.code;
    const vatRole = await em.findOneOrFail(
      AccountRole,
      { company: companyId, role: AccountRoleType.VAT_INPUT },
      { ...FILTER_OFF, populate: ['account'] },
    );
    vatCode = vatRole.account.code;

    // An accruing purchase type + a vendor, so the accrual path can be exercised beside the
    // payment path it now feeds. The seeded PR type does not accrue; this one is a copy that does.
    const prType = await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF);
    const accrType = em.create(DocumentType, {
      company: em.getReference(Company, companyId), code: 'ACCR', name: 'Accruing purchase',
      category: prType.category, requiresBudget: false, requiresQuota: false, requiresVendor: true,
      requiresItem: false, requiresPayee: true, requiresWarehouse: false,
      postAction: 'CUT_BUDGET', accruesOnApproval: true, isActive: true,
    } as never);
    em.create(FormTemplate, { documentType: accrType, version: 1, status: 'PUBLISHED' } as never);
    const apVendor = em.create(Vendor, { vendorCode: 'V-GL-AP', name: 'AP vendor', paymentTermDays: 30, isActive: true } as never);
    await em.flush();
    accruingTypeId = accrType.id;
    vendorId = apVendor.id;
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  /** Build a settled document: one ACTUAL cut against budget 5000 + a Payment with the given FX. */
  async function settle(
    lockedBase: string, actualBase: string, fxDelta: string, fxKind: string, baseTaxTotal = '0', whtAmount = '0',
    // A chain-settled document: it references a predecessor and holds no ACTUAL of its own.
    // `paidAt` pins the settlement instant for the entry-date cases; it defaults to now.
    //
    // `lines` gives the document real `document_line` rows, which the GRNI split reads. Each line
    // names whether its item is stock-tracked and, separately, whether the line carries a budget:
    // a settlement type is ordinarily not budget-controlled, so its lines are stamped with none and
    // only the reserving ancestor's carry one. `withBudget: false` is what reproduces that.
    chain: {
      refDocumentId?: string;
      withOwnActual?: boolean;
      paidAt?: Date;
      lines?: Array<{ lineNo: number; amount: string; stockTracked: boolean; withBudget?: boolean }>;
      /** Build it as a purchase of the accruing type, carrying a vendor. */
      accruing?: boolean;
    } = {},
  ): Promise<string> {
    const em = orm.em.fork();
    const dept = await em.findOneOrFail(Department, { company: companyId, deptCode: 'PROC' }, FILTER_OFF);
    const prType = await em.findOneOrFail(DocumentType, { code: chain.accruing ? 'ACCR' : 'PR' }, FILTER_OFF);
    const baseType = await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF);
    const mapping = await em.findOneOrFail(DeptDocType, { department: dept.id, documentType: baseType.id }, { ...FILTER_OFF, populate: ['formTemplate', 'workflow'] });
    const formTemplate = chain.accruing
      ? await em.findOneOrFail(FormTemplate, { documentType: accruingTypeId }, FILTER_OFF)
      : await em.findOneOrFail(FormTemplate, { id: mapping.formTemplate.id }, FILTER_OFF);
    const requester = await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF);
    const doc = em.create(Document, {
      docNo: `GL-${++seq}`, company: em.getReference(Company, companyId), department: dept,
      documentType: prType, formTemplate: em.getReference(FormTemplate, formTemplate.id),
      vendor: chain.accruing ? em.getReference(Vendor, vendorId) : undefined,
      workflow: em.getReference(Workflow, mapping.workflow.id), createdBy: requester,
      refDocument: chain.refDocumentId ? em.getReference(Document, chain.refDocumentId) : undefined,
      status: DocStatus.COMPLETED, currentStepNo: 1, baseTotalAmount: lockedBase, baseTaxTotal, createdAt: new Date(),
    });
    await em.flush();
    // Expense (net) = base_locked − base_tax_total; the VAT line closes the entry to base_locked.
    const expenseNet = (Number(lockedBase) - Number(baseTaxTotal)).toFixed(2);
    if (chain.withOwnActual !== false) {
      em.create(BudgetTxn, { budget: em.getReference(Budget, budgetId), document: doc, txnType: BudgetTxnType.ACTUAL, amount: expenseNet, createdAt: new Date() });
    }
    for (const l of chain.lines ?? []) {
      em.create(DocumentLine, {
        document: doc,
        lineNo: l.lineNo,
        item: em.getReference(Item, l.stockTracked ? stockItemId : plainItemId),
        description: l.stockTracked ? 'stock line' : 'service line',
        qty: '1',
        unitPrice: l.amount,
        lineAmount: l.amount,
        budgetBaseLineAmount: l.amount,
        // Omitted on a settlement document, which is the whole point of the chain case.
        budget: l.withBudget === false ? undefined : em.getReference(Budget, budgetId),
        lineStatus: 'OPEN',
      } as never);
    }
    em.create(Payment, {
      company: em.getReference(Company, companyId), document: doc,
      lockedRate: '1', actualRate: '1', baseLocked: lockedBase, baseActual: actualBase,
      fxDelta, fxKind, whtAmount, paidAt: chain.paidAt ?? new Date(), createdAt: new Date(),
    });
    await em.flush();
    return doc.id;
  }

  async function entryFor(documentId: string) {
    return orm.em.fork().findOne(JournalEntry, { sourceType: 'PAYMENT', sourceId: documentId }, { ...FILTER_OFF, populate: ['lines', 'lines.account'] });
  }
  const sideFor = (entry: JournalEntry, code: string, side: 'debit' | 'credit') =>
    entry.lines.getItems().filter((l) => l.account.code === code).reduce((s, l) => s + Number(l[side]), 0);

  it('posts a balanced 2-line entry when there is no FX difference', async () => {
    const doc = await settle('100000.00', '100000.00', '0.00', 'NONE');
    await posting.postForPayment(doc);
    const entry = await entryFor(doc);
    expect(entry).toBeTruthy();
    const lines = entry!.lines.getItems();
    expect(lines).toHaveLength(2);
    expect(sideFor(entry!, '5000', 'debit')).toBe(100000);
    expect(sideFor(entry!, CLEARING, 'credit')).toBe(100000);
    const dr = lines.reduce((s, l) => s + Number(l.debit), 0);
    const cr = lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(dr).toBe(cr);
  });

  it('posts an FX loss on the debit side', async () => {
    const doc = await settle('100000.00', '102000.00', '2000.00', 'LOSS');
    await posting.postForPayment(doc);
    const entry = await entryFor(doc);
    expect(sideFor(entry!, '5000', 'debit')).toBe(100000);
    expect(sideFor(entry!, '7100', 'debit')).toBe(2000); // FX loss
    expect(sideFor(entry!, CLEARING, 'credit')).toBe(102000);
  });

  it('posts an FX gain on the credit side', async () => {
    const doc = await settle('100000.00', '98000.00', '-2000.00', 'GAIN');
    await posting.postForPayment(doc);
    const entry = await entryFor(doc);
    expect(sideFor(entry!, '5000', 'debit')).toBe(100000);
    expect(sideFor(entry!, CLEARING, 'credit')).toBe(98000);
    expect(sideFor(entry!, '4900', 'credit')).toBe(2000); // FX gain
  });

  it('posts input VAT: Dr expense + Dr VAT_INPUT, Cr cash, balanced', async () => {
    // net 100000 + VAT 7000 → base_locked = base_actual = 107000, base_tax_total = 7000.
    const doc = await settle('107000.00', '107000.00', '0.00', 'NONE', '7000.00');
    await posting.postForPayment(doc);
    const entry = await entryFor(doc);
    expect(sideFor(entry!, '5000', 'debit')).toBe(100000); // expense net
    expect(sideFor(entry!, '1150', 'debit')).toBe(7000); // VAT_INPUT
    expect(sideFor(entry!, CLEARING, 'credit')).toBe(107000); // cash
    const lines = entry!.lines.getItems();
    const dr = lines.reduce((s, l) => s + Number(l.debit), 0);
    const cr = lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(dr).toBe(cr);
  });

  it('posts input VAT and WHT: Dr expense+VAT, Cr cash(net)+WHT_PAYABLE, balanced', async () => {
    // net 100000 + VAT 7000 → base 107000, base_tax_total 7000; WHT 3000 withheld.
    const doc = await settle('107000.00', '107000.00', '0.00', 'NONE', '7000.00', '3000.00');
    await posting.postForPayment(doc);
    const entry = await entryFor(doc);
    expect(sideFor(entry!, '5000', 'debit')).toBe(100000); // expense net
    expect(sideFor(entry!, '1150', 'debit')).toBe(7000); // VAT_INPUT
    expect(sideFor(entry!, '2100', 'credit')).toBe(3000); // WHT_PAYABLE
    expect(sideFor(entry!, CLEARING, 'credit')).toBe(104000); // cash net of WHT (107000 − 3000)
    const lines = entry!.lines.getItems();
    const dr = lines.reduce((s, l) => s + Number(l.debit), 0);
    const cr = lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(dr).toBe(cr);
  });

  it('omits the WHT line for a settlement with no WHT', async () => {
    const doc = await settle('60000.00', '60000.00', '0.00', 'NONE'); // whtAmount defaults to 0
    await posting.postForPayment(doc);
    const entry = await entryFor(doc);
    expect(sideFor(entry!, '2100', 'credit')).toBe(0); // no WHT_PAYABLE line
    expect(sideFor(entry!, CLEARING, 'credit')).toBe(60000); // full cash
  });

  it('omits the VAT line for a tax-free settlement', async () => {
    const doc = await settle('80000.00', '80000.00', '0.00', 'NONE'); // baseTaxTotal defaults to 0
    await posting.postForPayment(doc);
    const entry = await entryFor(doc);
    expect(sideFor(entry!, '1150', 'debit')).toBe(0); // no VAT_INPUT line
    expect(entry!.lines.getItems()).toHaveLength(2);
  });

  it('posts a chain-settled payment from its ancestor ACTUAL (PROC→PO→DISB)', async () => {
    // Only the reserving ancestor holds and is settled, so the paid document carries no ACTUAL
    // of its own; the expense side must still be found by walking ref_document_id.
    const ancestor = await settle('45000.00', '45000.00', '0.00', 'NONE');
    const paid = await settle('45000.00', '45000.00', '0.00', 'NONE', '0', '0', {
      refDocumentId: ancestor,
      withOwnActual: false,
    });

    await posting.postForPayment(paid);

    const entry = await entryFor(paid);
    expect(entry).toBeTruthy();
    expect(sideFor(entry!, '5000', 'debit')).toBe(45000);
    expect(sideFor(entry!, CLEARING, 'credit')).toBe(45000);
  });

  it('is idempotent — a second settle event posts no second entry', async () => {
    const doc = await settle('50000.00', '50000.00', '0.00', 'NONE');
    await posting.postForPayment(doc);
    await posting.postForPayment(doc);
    const count = await orm.em.fork().count(JournalEntry, { sourceType: 'PAYMENT', sourceId: doc }, FILTER_OFF);
    expect(count).toBe(1);
  });

  // ── Trade payables ────────────────────────────────────────────────────────────────────────────
  // A purchase that accrues recognises its expense, its input VAT and its GRNI at approval, and the
  // payment then clears only the debt. Posting expense again at payment would recognise the same
  // purchase twice — the failure the removed `assertRecognisedOnce` guard used to prevent.

  const accrualFor = (documentId: string) =>
    orm.em.fork().findOne(JournalEntry, { sourceType: 'APPROVAL_ACCRUAL', sourceId: documentId }, { ...FILTER_OFF, populate: ['lines', 'lines.account'] });

  it('recognises expense and input VAT at approval, and posts no VAT line at payment', async () => {
    const doc = await settle('107000.00', '107000.00', '0.00', 'NONE', '7000.00', '0', { accruing: true });
    await posting.postAccrualForApproval(doc);

    const accrual = await accrualFor(doc);
    expect(sideFor(accrual!, '5000', 'debit')).toBe(100000);
    expect(sideFor(accrual!, vatCode, 'debit')).toBe(7000);
    expect(sideFor(accrual!, apCode, 'credit')).toBe(107000);

    await posting.postForPayment(doc);
    const entry = await entryFor(doc);
    // The payment moves cash and the debt, nothing else. Both halves matter: the first shows the
    // payable is cleared, the second that VAT MOVED rather than being posted in both places.
    expect(sideFor(entry!, apCode, 'debit')).toBe(107000);
    expect(sideFor(entry!, vatCode, 'debit')).toBe(0);
    expect(sideFor(entry!, '5000', 'debit')).toBe(0);
  });

  it('clears GRNI at approval for a stock purchase, and the payable at payment', async () => {
    const doc = await settle('60000.00', '60000.00', '0.00', 'NONE', '0', '0', {
      accruing: true,
      lines: [{ lineNo: 1, amount: '60000.00', stockTracked: true }],
    });
    await posting.postAccrualForApproval(doc);

    const accrual = await accrualFor(doc);
    expect(sideFor(accrual!, grniCode, 'debit')).toBe(60000);
    expect(sideFor(accrual!, '5000', 'debit')).toBe(0);

    await posting.postForPayment(doc);
    const entry = await entryFor(doc);
    expect(sideFor(entry!, apCode, 'debit')).toBe(60000);
    expect(sideFor(entry!, grniCode, 'debit')).toBe(0); // not a second time
  });

  it('leaves a document with no accrual posting exactly what it posted before', async () => {
    // The regression guard for every type that has not opted in — which is all of them but one.
    const doc = await settle('40000.00', '40000.00', '0.00', 'NONE');
    await posting.postForPayment(doc);

    const entry = await entryFor(doc);
    expect(sideFor(entry!, '5000', 'debit')).toBe(40000);
    expect(sideFor(entry!, CLEARING, 'credit')).toBe(40000);
    expect(sideFor(entry!, apCode, 'debit')).toBe(0);
    expect(entry!.lines.getItems()).toHaveLength(2);
  });

  it('clears an accrued payable at the rate it was raised at, sending the difference to FX', async () => {
    const doc = await settle('50000.00', '51000.00', '1000.00', 'LOSS', '0', '0', { accruing: true });
    await posting.postAccrualForApproval(doc);
    await posting.postForPayment(doc);

    const entry = await entryFor(doc);
    // Each line asserted: a wrong split still balances.
    expect(sideFor(entry!, apCode, 'debit')).toBe(50000); // raised at the locked rate, cleared there
    expect(sideFor(entry!, '7100', 'debit')).toBe(1000); // FX_LOSS absorbs the whole difference
    expect(sideFor(entry!, CLEARING, 'credit')).toBe(51000);
  });

  it('withholds tax from an accrued payment without touching the payable', async () => {
    const doc = await settle('30000.00', '30000.00', '0.00', 'NONE', '0', '900.00', { accruing: true });
    await posting.postAccrualForApproval(doc);
    await posting.postForPayment(doc);

    const entry = await entryFor(doc);
    expect(sideFor(entry!, apCode, 'debit')).toBe(30000); // the vendor is owed the gross
    expect(sideFor(entry!, '2100', 'credit')).toBe(900); // WHT_PAYABLE
    expect(sideFor(entry!, CLEARING, 'credit')).toBe(29100); // cash net of it
  });

  // ── The GRNI split ────────────────────────────────────────────────────────────────────────────
  // Goods capitalized into INVENTORY at receipt must not be expensed again at payment; the payment
  // clears the GRNI the receipt raised. Expense is charged once, when the stock is issued.

  it('settles a stock purchase against GRNI, not expense', async () => {
    const doc = await settle('100000.00', '100000.00', '0.00', 'NONE', '0', '0', {
      lines: [{ lineNo: 1, amount: '100000.00', stockTracked: true }],
    });
    await posting.postForPayment(doc);

    const entry = await entryFor(doc);
    expect(sideFor(entry!, grniCode, 'debit')).toBe(100000);
    expect(sideFor(entry!, '5000', 'debit')).toBe(0);
  });

  it('settles a CHAIN-settled stock purchase against GRNI too', async () => {
    // The shape almost every real purchase has: the PR reserved and holds the ACTUAL, the DISB
    // references it and — being a settlement type — carries no budget on its own lines. The stock
    // portion must still be found, or the whole amount debits expense and the purchase goes
    // through profit and loss twice while GRNI is never cleared.
    const ancestor = await settle('80000.00', '80000.00', '0.00', 'NONE', '0', '0', {
      lines: [{ lineNo: 1, amount: '80000.00', stockTracked: true }],
    });
    const paid = await settle('80000.00', '80000.00', '0.00', 'NONE', '0', '0', {
      refDocumentId: ancestor,
      withOwnActual: false,
      lines: [{ lineNo: 1, amount: '80000.00', stockTracked: true, withBudget: false }],
    });

    await posting.postForPayment(paid);

    const entry = await entryFor(paid);
    expect(sideFor(entry!, grniCode, 'debit')).toBe(80000);
    expect(sideFor(entry!, '5000', 'debit')).toBe(0);
  });

  it('splits a mixed document between GRNI and expense', async () => {
    const doc = await settle('50000.00', '50000.00', '0.00', 'NONE', '0', '0', {
      lines: [
        { lineNo: 1, amount: '30000.00', stockTracked: true },
        { lineNo: 2, amount: '20000.00', stockTracked: false },
      ],
    });
    await posting.postForPayment(doc);

    // Both sides asserted, not just the total: a wrong split still balances.
    const entry = await entryFor(doc);
    expect(sideFor(entry!, grniCode, 'debit')).toBe(30000);
    expect(sideFor(entry!, '5000', 'debit')).toBe(20000);
  });

  it('leaves a document with no stock line debiting expense exactly as before', async () => {
    const doc = await settle('12000.00', '12000.00', '0.00', 'NONE', '0', '0', {
      lines: [{ lineNo: 1, amount: '12000.00', stockTracked: false }],
    });
    await posting.postForPayment(doc);

    const entry = await entryFor(doc);
    expect(sideFor(entry!, '5000', 'debit')).toBe(12000);
    expect(sideFor(entry!, grniCode, 'debit')).toBe(0);
  });

  it('never debits GRNI for more than was cut on the account', async () => {
    // Lines totalling more than the ACTUAL cut — the cap is what stops the GRNI debit exceeding
    // the expense it displaces and leaving a negative remainder behind.
    const doc = await settle('10000.00', '10000.00', '0.00', 'NONE', '0', '0', {
      lines: [{ lineNo: 1, amount: '25000.00', stockTracked: true }],
    });
    await posting.postForPayment(doc);

    const entry = await entryFor(doc);
    expect(sideFor(entry!, grniCode, 'debit')).toBe(10000);
    expect(sideFor(entry!, '5000', 'debit')).toBe(0);
  });

  it('dates the entry by the company day, not the UTC day', async () => {
    // The seed company runs at UTC+7. 23:30 UTC on 31 July is 06:30 on 1 August in Vientiane, so
    // this payment belongs to August — under the old `toISOString()` derivation it was dated
    // 2026-07-31 and fell into the July income statement. A midday instant would pass either way.
    const em = orm.em.fork();
    const company = await em.findOneOrFail(Company, { id: companyId }, FILTER_OFF);
    company.timezone = 'Asia/Vientiane';
    await em.flush();

    const doc = await settle('100000.00', '100000.00', '0.00', 'NONE', '0', '0', {
      paidAt: new Date('2026-07-31T23:30:00Z'),
    });
    await posting.postForPayment(doc);
    expect((await entryFor(doc))!.entryDate).toBe('2026-08-01');
  });

  it('dates an entry whose instant is already in the company day unchanged', async () => {
    // The other side of the boundary: 09:00 UTC is 16:00 the same day in Vientiane, so the day is
    // the UTC one here. Pinning both directions is what shows the zone is applied, not added.
    const doc = await settle('100000.00', '100000.00', '0.00', 'NONE', '0', '0', {
      paidAt: new Date('2026-07-31T09:00:00Z'),
    });
    await posting.postForPayment(doc);
    expect((await entryFor(doc))!.entryDate).toBe('2026-07-31');
  });

  // Destructive: this drops the company's CASH_CLEARING mapping and does not restore it, so every
  // posting case must sit above it.
  it('fails the posting (no entry) when a required role is unmapped', async () => {
    // Remove the CASH_CLEARING mapping, then attempt to post.
    const em = orm.em.fork();
    em.setFilterParams('company', { companyId });
    await em.nativeDelete(AccountRole, { company: companyId, role: 'CASH_CLEARING' });
    const doc = await settle('10000.00', '10000.00', '0.00', 'NONE');
    await expect(posting.postForPayment(doc)).rejects.toThrow(/CASH_CLEARING/);
    const entry = await entryFor(doc);
    expect(entry).toBeNull();
  });

  it('rejects mutating a journal entry (append-only)', async () => {
    // Insert a bare entry directly, then attempt to update it — the ledger guard must reject.
    const em = orm.em.fork();
    const entry = em.create(JournalEntry, {
      company: em.getReference(Company, companyId),
      entryDate: '2026-07-07', sourceType: 'PAYMENT', sourceId: '00000000-0000-4000-8000-000000000001',
      createdAt: new Date(),
    });
    await em.flush();
    entry.memo = 'tampered';
    await expect(em.flush()).rejects.toThrow(/append-only|update/i);
  });
});

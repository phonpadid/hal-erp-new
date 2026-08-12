import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { AccountingPeriodStatus, DocStatus } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AccountingPeriod, AccountingPeriodLog } from '../accounting/period/accounting-period.entities';
import { AccountingPeriodService } from '../accounting/period/accounting-period.service';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
import { Workflow } from '../approval/approval.entities';
import { Budget } from '../budget/budget.entities';
import { DeptDocType, Document, DocumentLine, DocumentType, FormTemplate } from '../document/document.entities';
import { Item, ItemCompany } from '../master-data/master-data.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { AccountRoleService } from './account-role.service';
import { SOURCE_PERIOD_ACCRUAL, SOURCE_PERIOD_ACCRUAL_REVERSAL } from './gl-posting.service';
import { AccountRole, JournalEntry, JournalLine } from './gl.entities';
import { JournalService } from './journal.service';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { FxRevaluationService } from './fx-revaluation.service';
import { ReceivedNotInvoicedService } from './received-not-invoiced.service';
import { YearCloseService } from './year-close.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * What a month consumed but was not yet billed for.
 *
 * Without this, a service received on the 28th and invoiced on the 5th is expensed in the wrong
 * month and its liability appears in neither. Stock is already covered by GRNI; this is the same
 * accrual for everything GRNI does not reach.
 */
describe.skipIf(!hasDb)('period-close accrual (DB-backed)', () => {
  let orm: MikroORM;
  let periods: AccountingPeriodService;
  let companyId = '';
  let fiscalYearId = '';
  let userId = '';
  let deptId = '';
  let budgetId = '';
  let expenseCode = '';
  let accruedCode = '';
  let serviceItemId = '';
  let stockItemId = '';
  let seq = 0;

  const asCompany = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId, companyId, departmentId: deptId, grants: [] }, fn);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());
    const scope = new CompanyScopeService(orm.em);
    periods = new AccountingPeriodService(
      scope,
      new JournalService(scope),
      new ReceivedNotInvoicedService(orm.em),
      new FxRevaluationService(orm.em, new ExchangeRateService(orm.em)),
      new AccountRoleService(orm.em),
      new PeriodGuardService(),
      new YearCloseService(new AccountRoleService(orm.em), new PeriodGuardService()),
    );

    const em = orm.em.fork();
    companyId = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    const fy = await em.findOneOrFail(FiscalYear, { company: companyId }, FILTER_OFF);
    fiscalYearId = fy.id;
    userId = (await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF)).id;
    deptId = (await em.findOneOrFail(Department, { company: companyId, deptCode: 'PROC' }, FILTER_OFF)).id;
    const budget = await em.findOneOrFail(Budget, { glAccount: '5000' }, { ...FILTER_OFF, populate: ['account'] });
    budgetId = budget.id;
    expenseCode = budget.account!.code;
    accruedCode = (await em.findOneOrFail(
      AccountRole, { company: companyId, role: 'ACCRUED_EXPENSE' }, { ...FILTER_OFF, populate: ['account'] },
    )).account.code;

    const service = em.create(Item, { itemCode: 'ACC-SVC', name: 'A service', isStockTracked: false, isActive: true });
    const stock = em.create(Item, { itemCode: 'ACC-STK', name: 'Stocked', isStockTracked: true, isActive: true });
    for (const item of [service, stock]) {
      em.create(ItemCompany, { item, company: em.getReference(Company, companyId), isActive: true, defaultGlAccount: '5000' } as never);
    }
    await em.flush();
    serviceItemId = service.id;
    stockItemId = stock.id;
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  const yr = () => new Date().getUTCFullYear();
  const dt = (mm: number, dd: number) => `${yr()}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;

  /**
   * A PROC that reserved (its lines carry the budget) and the PO beneath it that was received.
   * The PO's own lines carry NO budget, which is the ordinary shape and the reason the account has
   * to come from the chain.
   */
  async function receivedOrder(opts: {
    qty: string; received: string; baseAmount: string; item?: 'service' | 'stock' | 'none';
    invoiced?: string;
    /** When the goods arrived. Null (the default) means "at some unknown past time". */
    receivedAt?: Date;
  }): Promise<void> {
    const em = orm.em.fork();
    const dept = await em.findOneOrFail(Department, { id: deptId }, FILTER_OFF);
    const procType = await em.findOneOrFail(DocumentType, { code: 'PROC' }, FILTER_OFF);
    const poType = await em.findOneOrFail(DocumentType, { code: 'PO' }, FILTER_OFF);
    const mapping = await em.findOneOrFail(DeptDocType, { department: deptId, documentType: procType.id }, { ...FILTER_OFF, populate: ['formTemplate', 'workflow'] });
    const base = {
      company: em.getReference(Company, companyId), department: dept,
      formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id),
      createdBy: em.getReference(AppUser, userId),
      status: DocStatus.COMPLETED, currentStepNo: 1, createdAt: new Date(),
    };
    const n = ++seq;
    const proc = em.create(Document, { ...base, docNo: `ACC-PROC-${n}`, documentType: procType } as never);
    await em.flush();
    const po = em.create(Document, { ...base, docNo: `ACC-PO-${n}`, documentType: poType, refDocument: proc } as never);
    await em.flush();

    const item = opts.item === 'none' ? undefined
      : em.getReference(Item, opts.item === 'stock' ? stockItemId : serviceItemId);
    // Only the PROC's line carries the budget — the PO type is not budget-controlled.
    em.create(DocumentLine, {
      document: proc, lineNo: 1, item, description: 'line', qty: opts.qty,
      unitPrice: '1', lineAmount: opts.baseAmount, budgetBaseLineAmount: opts.baseAmount,
      budget: em.getReference(Budget, budgetId), lineStatus: 'OPEN',
    } as never);
    em.create(DocumentLine, {
      document: po, lineNo: 1, item, description: 'line', qty: opts.qty,
      unitPrice: '1', lineAmount: opts.baseAmount, budgetBaseLineAmount: opts.baseAmount,
      receivedQty: opts.received, lastReceivedAt: opts.receivedAt, lineStatus: 'PARTIAL',
    } as never);
    await em.flush();

    if (opts.invoiced) {
      const disbType = await em.findOneOrFail(DocumentType, { code: 'DISB' }, FILTER_OFF);
      const disb = em.create(Document, { ...base, docNo: `ACC-DISB-${n}`, documentType: disbType, refDocument: po } as never);
      await em.flush();
      em.create(DocumentLine, {
        document: disb, lineNo: 1, item, description: 'line', qty: opts.invoiced,
        unitPrice: '1', lineAmount: opts.invoiced, lineStatus: 'OPEN',
      } as never);
      await em.flush();
    }
  }

  const declare = (code: string, start: string, end: string) =>
    asCompany(() => periods.declare({ fiscalYearId, code, periodStart: start, periodEnd: end }));

  const entry = (sourceType: string, periodId: string) =>
    orm.em.fork().findOne(JournalEntry, { sourceType, sourceId: periodId }, FILTER_OFF);
  const linesOf = (entryId: string) =>
    orm.em.fork().find(JournalLine, { journalEntry: entryId }, { ...FILTER_OFF, populate: ['account'] });
  const side = (lines: JournalLine[], code: string, s: 'debit' | 'credit') =>
    lines.filter((l) => l.account.code === code).reduce((t, l) => t + Number(l[s]), 0);

  const reset = async () => {
    const em = orm.em.fork();
    await em.nativeDelete(AccountingPeriodLog, {});
    await em.nativeDelete(AccountingPeriod, { company: companyId }, FILTER_OFF);
    await em.nativeDelete(JournalLine, {}, FILTER_OFF);
    await em.nativeDelete(JournalEntry, {}, FILTER_OFF);
    await em.nativeDelete(DocumentLine, {}, FILTER_OFF);
  };

  it('accrues a received, uninvoiced service and reverses it the next day', async () => {
    await reset();
    await receivedOrder({ qty: '10', received: '10', baseAmount: '10000.00', item: 'service' });
    const p = await declare('AC-JUN', dt(6, 1), dt(6, 30));
    await asCompany(() => periods.close(p.id));

    const accrual = await entry(SOURCE_PERIOD_ACCRUAL, p.id);
    expect(accrual?.entryDate).toBe(dt(6, 30));
    const aLines = await linesOf(accrual!.id);
    expect(side(aLines, expenseCode, 'debit')).toBe(10000);
    expect(side(aLines, accruedCode, 'credit')).toBe(10000);

    // The pair is the whole mechanism: a reversal that is a future intention is how the same
    // expense gets recognised twice.
    const reversal = await entry(SOURCE_PERIOD_ACCRUAL_REVERSAL, p.id);
    expect(reversal?.entryDate).toBe(dt(7, 1));
    const rLines = await linesOf(reversal!.id);
    expect(side(rLines, expenseCode, 'credit')).toBe(10000);
    expect(side(rLines, accruedCode, 'debit')).toBe(10000);
  });

  it('accrues what was received by the period end, and not what came after', async () => {
    // The whole reason `last_received_at` exists: `received_qty` is a running total with no time
    // attached, so without it a close would accrue goods that arrived after the month it is closing.
    await reset();
    await receivedOrder({ qty: '1', received: '1', baseAmount: '2000.00', item: 'service', receivedAt: new Date(`${yr()}-02-15T04:00:00Z`) });
    await receivedOrder({ qty: '1', received: '1', baseAmount: '9000.00', item: 'service', receivedAt: new Date(`${yr()}-03-15T04:00:00Z`) });
    const p = await declare('AC-FEB', dt(2, 1), dt(2, 28));
    await asCompany(() => periods.close(p.id));

    const accrual = await entry(SOURCE_PERIOD_ACCRUAL, p.id);
    // February's receipt only. March's is not February's expense.
    expect(side(await linesOf(accrual!.id), accruedCode, 'credit')).toBe(2000);
  });

  it('accrues a receipt whose date is unknown', async () => {
    // A line received before `last_received_at` existed. Counting it is the honest choice: the
    // goods were received, and excluding them would understate silently rather than admit the gap.
    await reset();
    await receivedOrder({ qty: '1', received: '1', baseAmount: '1200.00', item: 'service' });
    const p = await declare('AC-MAR', dt(3, 1), dt(3, 31));
    await asCompany(() => periods.close(p.id));

    const accrual = await entry(SOURCE_PERIOD_ACCRUAL, p.id);
    expect(side(await linesOf(accrual!.id), accruedCode, 'credit')).toBe(1200);
  });

  it('accrues only the uninvoiced remainder', async () => {
    await reset();
    await receivedOrder({ qty: '10', received: '10', baseAmount: '10000.00', item: 'service', invoiced: '4' });
    const p = await declare('AC-JUL', dt(7, 1), dt(7, 31));
    await asCompany(() => periods.close(p.id));

    const accrual = await entry(SOURCE_PERIOD_ACCRUAL, p.id);
    // 6 of 10 units at 1,000 each.
    expect(side(await linesOf(accrual!.id), accruedCode, 'credit')).toBe(6000);
  });

  it('does not accrue a stock-tracked line', async () => {
    // Its receipt already credited GRNI — this accrual under another name. Accruing again would
    // recognise the same purchase twice.
    await reset();
    await receivedOrder({ qty: '5', received: '5', baseAmount: '5000.00', item: 'stock' });
    const p = await declare('AC-AUG', dt(8, 1), dt(8, 31));
    await asCompany(() => periods.close(p.id));

    expect(await entry(SOURCE_PERIOD_ACCRUAL, p.id)).toBeNull();
  });

  it('accrues an item-less line', async () => {
    // A free-text service line is exactly the case with no other coverage, and the one an
    // over-eager "must have an untracked item" filter would drop.
    await reset();
    await receivedOrder({ qty: '2', received: '2', baseAmount: '4000.00', item: 'none' });
    const p = await declare('AC-SEP', dt(9, 1), dt(9, 30));
    await asCompany(() => periods.close(p.id));

    const accrual = await entry(SOURCE_PERIOD_ACCRUAL, p.id);
    expect(side(await linesOf(accrual!.id), accruedCode, 'credit')).toBe(4000);
  });

  it('posts nothing when everything received has been invoiced', async () => {
    await reset();
    await receivedOrder({ qty: '3', received: '3', baseAmount: '3000.00', item: 'service', invoiced: '3' });
    const p = await declare('AC-OCT', dt(10, 1), dt(10, 31));
    await asCompany(() => periods.close(p.id));

    expect(await entry(SOURCE_PERIOD_ACCRUAL, p.id)).toBeNull();
    expect(await entry(SOURCE_PERIOD_ACCRUAL_REVERSAL, p.id)).toBeNull();
  });

  it('does not accrue twice when a period is reopened and closed again', async () => {
    await reset();
    await receivedOrder({ qty: '1', received: '1', baseAmount: '1500.00', item: 'service' });
    const p = await declare('AC-NOV', dt(11, 1), dt(11, 30));
    await asCompany(() => periods.close(p.id));
    await asCompany(() => periods.reopen(p.id, 'a correction was needed'));
    await asCompany(() => periods.close(p.id));

    const accruals = await orm.em.fork().find(JournalEntry, { sourceType: SOURCE_PERIOD_ACCRUAL, sourceId: p.id }, FILTER_OFF);
    const reversals = await orm.em.fork().find(JournalEntry, { sourceType: SOURCE_PERIOD_ACCRUAL_REVERSAL, sourceId: p.id }, FILTER_OFF);
    expect(accruals).toHaveLength(1);
    expect(reversals).toHaveLength(1);
  });

  it('writes no budget_txn', async () => {
    await reset();
    const { BudgetTxn } = await import('../budget/budget.entities');
    const before = await orm.em.fork().count(BudgetTxn, {}, FILTER_OFF);
    await receivedOrder({ qty: '1', received: '1', baseAmount: '900.00', item: 'service' });
    const p = await declare('AC-DEC', dt(12, 1), dt(12, 31));
    await asCompany(() => periods.close(p.id));

    expect(await orm.em.fork().count(BudgetTxn, {}, FILTER_OFF)).toBe(before);
  });

  it('refuses the close when ACCRUED_EXPENSE is unmapped, leaving the period open', async () => {
    // A close is synchronous, unlike an event-driven posting: its caller can map the account and
    // try again, so refusing beats closing a month with its accrual missing.
    await reset();
    const em = orm.em.fork();
    await em.nativeDelete(AccountRole, { company: companyId, role: 'ACCRUED_EXPENSE' }, FILTER_OFF);
    await receivedOrder({ qty: '1', received: '1', baseAmount: '700.00', item: 'service' });
    const p = await declare('AC-JAN', dt(1, 1), dt(1, 31));

    await expect(asCompany(() => periods.close(p.id))).rejects.toThrow(/ACCRUED_EXPENSE/);
    const still = await orm.em.fork().findOneOrFail(AccountingPeriod, { id: p.id }, FILTER_OFF);
    expect(still.status).toBe(AccountingPeriodStatus.OPEN);

    const restore = orm.em.fork();
    const acct = await restore.findOneOrFail(
      (await import('../accounting/accounting.entities')).Account,
      { company: companyId, code: accruedCode }, FILTER_OFF,
    );
    restore.create(AccountRole, { company: restore.getReference(Company, companyId), role: 'ACCRUED_EXPENSE', account: acct } as never);
    await restore.flush();
  });
});

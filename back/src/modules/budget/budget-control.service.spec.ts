import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BudgetTxnType, ControlPolicy } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetLedgerService } from './budget-ledger.service';
import { Budget, BudgetTxn } from './budget.entities';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

describe.skipIf(!hasDb)('budget-control ledger (DB-backed)', () => {
  let orm: MikroORM;
  let balance: BudgetBalanceService;
  let ledger: BudgetLedgerService;

  const ids = { companyA: '', companyB: '', deptA: '', deptB: '', fyA: '', fyA2: '', fyB: '', docA: '' };
  let gl = 0;

  async function makeBudget(
    amountTotal: string,
    policy: ControlPolicy = ControlPolicy.HARD_STOP,
    fiscalYearId = ids.fyA,
    departmentId = ids.deptA,
  ): Promise<string> {
    const em = orm.em.fork();
    const b = em.create(Budget, {
      fiscalYear: em.getReference(FiscalYear, fiscalYearId),
      department: em.getReference(Department, departmentId),
      glAccount: `GL-${gl++}`,
      amountTotal,
      controlPolicy: policy,
      status: 'ACTIVE',
    });
    await em.persistAndFlush(b);
    return b.id;
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const em = orm.em.fork();
    const companyA = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const companyB = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', isActive: true });
    const deptA = em.create(Department, { company: companyA, deptCode: 'DA', name: 'DA', isActive: true });
    const deptB = em.create(Department, { company: companyB, deptCode: 'DB', name: 'DB', isActive: true });
    const fyA = em.create(FiscalYear, { company: companyA, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const fyA2 = em.create(FiscalYear, { company: companyA, year: 2027, startDate: '2027-01-01', endDate: '2027-12-31', status: 'OPEN' });
    const fyB = em.create(FiscalYear, { company: companyB, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });

    // Minimal document graph (budget_txn.document_id is NOT NULL).
    const docType = em.create(DocumentType, { code: 'PR', name: 'PR', category: 'PROCUREMENT' as any });
    const template = em.create(FormTemplate, { documentType: docType, version: 1, status: 'PUBLISHED' });
    const workflow = em.create(Workflow, { company: companyA, name: 'WF', isActive: true });
    const docA = em.create(Document, {
      docNo: 'PR-A-2026-0001',
      company: companyA,
      department: deptA,
      documentType: docType,
      formTemplate: template,
      workflow,
      currentStepNo: 0,
      createdBy: user,
      exchangeRate: '1',
      status: 'DRAFT' as any,
    });

    await em.flush();
    Object.assign(ids, {
      companyA: companyA.id, companyB: companyB.id, deptA: deptA.id, deptB: deptB.id,
      fyA: fyA.id, fyA2: fyA2.id, fyB: fyB.id, docA: docA.id,
    });
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  beforeEach(() => {
    balance = new BudgetBalanceService(orm.em);
    ledger = new BudgetLedgerService(orm.em, balance);
  });

  function txn(em: EntityManager, budgetId: string, type: BudgetTxnType, amount: string) {
    return em.create(BudgetTxn, {
      budget: em.getReference(Budget, budgetId),
      document: em.getReference(Document, ids.docA),
      txnType: type,
      amount,
      createdAt: new Date(),
    });
  }

  // ---- 5.1 Derived balance & multi-line reserve ------------------------------

  it('derives balance from the ledger without mutating amount_total', async () => {
    const b = await makeBudget('1000000');
    const em = orm.em.fork();
    em.persist(txn(em, b, BudgetTxnType.RESERVE, '100000'));
    em.persist(txn(em, b, BudgetTxnType.RELEASE, '40000'));
    await em.flush();

    expect(Number(await balance.availableBalance(b))).toBe(940000);
    const reread = await orm.em.fork().findOneOrFail(Budget, { id: b }, { filters: { company: false } });
    expect(Number(reread.amountTotal)).toBe(1000000);
  });

  it('reserves once per budget, summing that budget\'s lines', async () => {
    const bx = await makeBudget('1000000');
    const by = await makeBudget('1000000');
    await ledger.reserve(ids.docA, [
      { budgetId: bx, baseAmount: '30000' },
      { budgetId: bx, baseAmount: '20000' },
      { budgetId: by, baseAmount: '10000' },
    ]);
    const em = orm.em.fork();
    const xs = await em.find(BudgetTxn, { budget: bx, txnType: BudgetTxnType.RESERVE }, { filters: { company: false } });
    const ys = await em.find(BudgetTxn, { budget: by, txnType: BudgetTxnType.RESERVE }, { filters: { company: false } });
    expect(xs).toHaveLength(1);
    expect(Number(xs[0].amount)).toBe(50000);
    expect(ys).toHaveLength(1);
    expect(Number(ys[0].amount)).toBe(10000);
  });

  // ---- 5.2 Over-limit policy -------------------------------------------------

  it('HARD_STOP blocks an over-budget reserve; SOFT_WARNING allows with a warning', async () => {
    const hard = await makeBudget('50000', ControlPolicy.HARD_STOP);
    await expect(ledger.reserve(ids.docA, [{ budgetId: hard, baseAmount: '60000' }])).rejects.toThrow();

    const soft = await makeBudget('50000', ControlPolicy.SOFT_WARNING);
    const res = await ledger.reserve(ids.docA, [{ budgetId: soft, baseAmount: '60000' }]);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0].budgetId).toBe(soft);
  });

  // ---- 5.3 Reserve → actual → release, and auto-release ----------------------

  it('settles to ACTUAL plus the exact RELEASE remainder', async () => {
    const b = await makeBudget('1000000');
    await ledger.reserve(ids.docA, [{ budgetId: b, baseAmount: '100000' }]);
    await ledger.settle(ids.docA, b, '90000');

    const em = orm.em.fork();
    const actual = await em.find(BudgetTxn, { budget: b, txnType: BudgetTxnType.ACTUAL }, { filters: { company: false } });
    const release = await em.find(BudgetTxn, { budget: b, txnType: BudgetTxnType.RELEASE }, { filters: { company: false } });
    expect(Number(actual[0].amount)).toBe(90000);
    expect(Number(release[0].amount)).toBe(10000);
    expect(Number(await balance.outstandingReserved(ids.docA, b))).toBe(0);
  });

  it('auto-releases the full outstanding on reject/cancel', async () => {
    const b = await makeBudget('1000000');
    await ledger.reserve(ids.docA, [{ budgetId: b, baseAmount: '100000' }]);
    await ledger.releaseAll(ids.docA);
    expect(Number(await balance.outstandingReserved(ids.docA, b))).toBe(0);
    // total back to full: 1,000,000 − 100,000 + 100,000
    expect(Number(await balance.availableBalance(b))).toBe(1000000);
  });

  // ---- 5.4 Concurrency-safe reservation --------------------------------------

  it('serializes two concurrent full-balance reserves: exactly one succeeds', async () => {
    const b = await makeBudget('100000', ControlPolicy.HARD_STOP);
    const results = await Promise.allSettled([
      ledger.reserve(ids.docA, [{ budgetId: b, baseAmount: '100000' }]),
      ledger.reserve(ids.docA, [{ budgetId: b, baseAmount: '100000' }]),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(1);
    expect(Number(await balance.availableBalance(b))).toBe(0);
  });

  // ---- 5.5 Transfer & adjustment ---------------------------------------------

  it('transfers atomically and enforces boundaries', async () => {
    const x = await makeBudget('100000');
    const y = await makeBudget('0');
    await ledger.executeTransfer({ documentId: ids.docA, fromBudgetId: x, toBudgetId: y, amount: '100000' });
    expect(Number(await balance.availableBalance(x))).toBe(0);
    expect(Number(await balance.availableBalance(y))).toBe(100000);

    // Source now empty → insufficient.
    await expect(
      ledger.executeTransfer({ documentId: ids.docA, fromBudgetId: x, toBudgetId: y, amount: '100000' }),
    ).rejects.toThrow();

    // Cross-company and cross-fiscal-year are forbidden.
    const xA = await makeBudget('100000');
    const inCompanyB = await makeBudget('0', ControlPolicy.HARD_STOP, ids.fyB, ids.deptB);
    const inYear2 = await makeBudget('0', ControlPolicy.HARD_STOP, ids.fyA2, ids.deptA);
    await expect(
      ledger.executeTransfer({ documentId: ids.docA, fromBudgetId: xA, toBudgetId: inCompanyB, amount: '10' }),
    ).rejects.toThrow();
    await expect(
      ledger.executeTransfer({ documentId: ids.docA, fromBudgetId: xA, toBudgetId: inYear2, amount: '10' }),
    ).rejects.toThrow();
  });

  it('adjustment raises the derived balance', async () => {
    const b = await makeBudget('100000');
    await ledger.executeAdjustment({ documentId: ids.docA, budgetId: b, amount: '200000', movementType: 'ADJUST_INCREASE' });
    expect(Number(await balance.availableBalance(b))).toBe(300000);
  });

  it('serializes two concurrent over-committing transfers: exactly one succeeds', async () => {
    const x = await makeBudget('100000');
    const y = await makeBudget('0');
    // Both try to move the full balance out of x at once; the source is locked
    // PESSIMISTIC_WRITE so only one can pass the available-balance check.
    const results = await Promise.allSettled([
      ledger.executeTransfer({ documentId: ids.docA, fromBudgetId: x, toBudgetId: y, amount: '100000' }),
      ledger.executeTransfer({ documentId: ids.docA, fromBudgetId: x, toBudgetId: y, amount: '100000' }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(1);
    expect(Number(await balance.availableBalance(x))).toBe(0);
    expect(Number(await balance.availableBalance(y))).toBe(100000);
  });

  // ---- 5.6 Append-only enforcement -------------------------------------------

  it('rejects updating a persisted budget_txn (append-only)', async () => {
    const b = await makeBudget('1000000');
    const em = orm.em.fork();
    const t = txn(em, b, BudgetTxnType.RESERVE, '100');
    em.persist(t);
    await em.flush();

    t.amount = '999';
    await expect(em.flush()).rejects.toThrow(/append-only/i);
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[budget-control] no database reachable — skipping DB-backed spec');
}

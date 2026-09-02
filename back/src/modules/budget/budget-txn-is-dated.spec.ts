import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BudgetTxnType } from '../../common/enums';
import { RequestContext } from '../../common/context/request-context';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { attachCoverage, budgetAt } from '../../test/budget-fixture';
import { Workflow } from '../approval/approval.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetCoverageService } from './budget-coverage.service';
import { BudgetLedgerService } from './budget-ledger.service';
import { Budget, BudgetTxn } from './budget.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Every budget row states the day its event happened, in the company's own timezone.
 *
 * It used to state nothing: `created_at` is when the row was inserted, it is nullable, and it is a
 * UTC instant rather than a calendar day. So a budget figure could not be stated as of a date, and
 * nothing could tell a row that consumed one year's appropriation on a day belonging to the next.
 */
describe.skipIf(!hasDb)('budget rows are dated (DB-backed)', () => {
  let orm: MikroORM;
  let ledger: BudgetLedgerService;
  let balance: BudgetBalanceService;
  const ids = { company: '', dept: '', fy: '', doc: '' };
  let gl = 0;
  let glCode = '';

  async function makeBudget(amountTotal = '1000000'): Promise<string> {
    const em = orm.em.fork();
    const b = budgetAt(em, {
      fiscalYear: em.getReference(FiscalYear, ids.fy),
      department: em.getReference(Department, ids.dept),
      // `code` and `glAccount` share one value, as the migration gives existing rows. Read the
      // counter ONCE: two `gl++` would number the two fields differently.
      code: (glCode = `TZ-${gl++}`),
      glAccount: glCode,
      amountTotal,
      status: 'ACTIVE',
    });
    attachCoverage(em, em.getReference(Company, ids.company), b);
    await em.persistAndFlush(b);
    return b.id;
  }

  const rows = (budgetId: string) =>
    orm.em.fork().find(BudgetTxn, { budget: budgetId }, FILTER_OFF);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    // UTC+7: the company's day turns over seven hours before UTC's does, which is the whole point.
    const company = em.create(Company, {
      code: 'TZB', nameTh: 'TZB', taxId: '1', branchCode: '00000',
      timezone: 'Asia/Bangkok', isActive: true,
    });
    const dept = em.create(Department, { company, deptCode: 'D', name: 'D', isActive: true });
    const fy = em.create(FiscalYear, { company, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const user = em.create(AppUser, { username: 'tz-budget', email: 'tzb@x', status: 'ACTIVE' });
    const dt = em.create(DocumentType, {
      company, code: 'TZBUD', name: 'Budgeted', category: 'ADMIN' as never,
      requiresBudget: true, requiresQuota: false, isActive: true,
    });
    const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
    const wf = em.create(Workflow, { company, name: 'TZ WF', isActive: true });
    const doc = em.create(Document, {
      docNo: 'TZ-D1', company, department: dept, documentType: dt, formTemplate: tmpl, workflow: wf,
      currentStepNo: 0, createdBy: user, exchangeRate: '1', baseTotalAmount: '100',
      status: 'DRAFT' as never, createdAt: new Date(),
    });
    await em.flush();
    Object.assign(ids, { company: company.id, dept: dept.id, fy: fy.id, doc: doc.id });

    const em2 = orm.em.fork();
    balance = new BudgetBalanceService(em2);
    ledger = new BudgetLedgerService(em2, balance, new BudgetCoverageService(em2));
  });

  afterAll(async () => {
    vi.useRealTimers();
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  const asUser = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: undefined, companyId: ids.company, departmentId: ids.dept, grants: [] }, fn);

  /** Run an operation with the wall clock pinned to an instant. */
  async function at<T>(instant: string, fn: () => Promise<T>): Promise<T> {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(instant));
    try {
      return await fn();
    } finally {
      vi.useRealTimers();
    }
  }

  it('dates a reservation by the company day, not the UTC day', async () => {
    const b = await makeBudget();
    // 23:30 UTC on 30 June is 06:30 on 1 July in Bangkok. The company's day is 1 July.
    await at('2026-06-30T23:30:00Z', () =>
      asUser(() => ledger.reserve(ids.doc, [{ budgetId: b, baseAmount: '100' }])),
    );
    const [row] = await rows(b);
    expect(row.txnType).toBe(BudgetTxnType.RESERVE);
    expect(row.txnDate).toBe('2026-07-01');
  });

  it('gives an ACTUAL and the RELEASE of its unused difference the same day', async () => {
    const b = await makeBudget();
    await at('2026-03-02T02:00:00Z', () =>
      asUser(() => ledger.reserve(ids.doc, [{ budgetId: b, baseAmount: '100' }])),
    );
    await at('2026-03-10T02:00:00Z', () => asUser(() => ledger.settle(ids.doc, b, '60')));

    const all = await rows(b);
    const actual = all.find((r) => r.txnType === BudgetTxnType.ACTUAL)!;
    const release = all.find((r) => r.txnType === BudgetTxnType.RELEASE)!;
    expect(actual.txnDate).toBe('2026-03-10');
    // One settlement is one event: the two halves must not fall either side of a boundary.
    expect(release.txnDate).toBe(actual.txnDate);
  });

  it('dates a release by the day it was released', async () => {
    const b = await makeBudget();
    await at('2026-04-01T02:00:00Z', () =>
      asUser(() => ledger.reserve(ids.doc, [{ budgetId: b, baseAmount: '100' }])),
    );
    await at('2026-04-09T02:00:00Z', () => asUser(() => ledger.releaseAll(ids.doc)));
    const release = (await rows(b)).find((r) => r.txnType === BudgetTxnType.RELEASE)!;
    expect(release.txnDate).toBe('2026-04-09');
  });

  it('dates a transfer pair by the movement, not by the approval', async () => {
    const from = await makeBudget();
    const to = await makeBudget();
    await at('2026-05-20T02:00:00Z', () =>
      asUser(() => ledger.reserve(ids.doc, [{ budgetId: from, baseAmount: '1' }])),
    );
    // Approved today, effective on a day the movement states.
    await at('2026-05-20T02:00:00Z', () =>
      asUser(() =>
        ledger.executeTransfer({
          documentId: ids.doc, fromBudgetId: from, toBudgetId: to, amount: '500',
          effectiveDate: '2026-05-01',
        }),
      ),
    );
    const out = (await rows(from)).find((r) => r.txnType === BudgetTxnType.TRANSFER_OUT)!;
    const into = (await rows(to)).find((r) => r.txnType === BudgetTxnType.TRANSFER_IN)!;
    expect(out.txnDate).toBe('2026-05-01');
    expect(into.txnDate).toBe(out.txnDate);
  });

  it('falls back to the approval day when a movement states no effective date', async () => {
    const b = await makeBudget();
    await at('2026-08-11T02:00:00Z', () =>
      asUser(() =>
        ledger.executeAdjustment({
          documentId: ids.doc, budgetId: b, amount: '250', movementType: 'ADJUST_INCREASE',
        }),
      ),
    );
    const adj = (await rows(b)).find((r) => r.txnType === BudgetTxnType.ADJUST_INCREASE)!;
    expect(adj.txnDate).toBe('2026-08-11');
  });

  it('states a balance as of a past day', async () => {
    const b = await makeBudget('1000');
    await at('2026-06-20T02:00:00Z', () =>
      asUser(() => ledger.reserve(ids.doc, [{ budgetId: b, baseAmount: '100' }])),
    );
    await at('2026-07-05T02:00:00Z', () =>
      asUser(() => ledger.reserve(ids.doc, [{ budgetId: b, baseAmount: '200' }])),
    );

    // As of 30 June only the June reservation has happened.
    expect(Number(await balance.availableBalance(b, undefined, '2026-06-30'))).toBe(900);
    // Unbounded, both have.
    expect(Number(await balance.availableBalance(b))).toBe(700);

    const asOfJune = await balance.breakdown(b, undefined, '2026-06-30');
    expect(Number(asOfJune.reserved)).toBe(100);
    expect(Number(asOfJune.available)).toBe(900);
  });

  it('bounds the ledger read to a past day', async () => {
    const b = await makeBudget('1000');
    await at('2026-06-20T02:00:00Z', () =>
      asUser(() => ledger.reserve(ids.doc, [{ budgetId: b, baseAmount: '100' }])),
    );
    await at('2026-07-05T02:00:00Z', () =>
      asUser(() => ledger.reserve(ids.doc, [{ budgetId: b, baseAmount: '200' }])),
    );
    const page = await asUser(() => balance.ledger(b, { asOf: '2026-06-30' }));
    expect(page.items).toHaveLength(1);
    expect(page.items[0].txnDate).toBe('2026-06-20');
  });

  // ---- A closed year's appropriation takes no more rows ----------------------
  //
  // The guard lives at the single point every `budget_txn` passes through, so no call site can
  // bypass it — it catches what the year-close refusal cannot: a posting delivering late, an
  // adjustment approved against last year, a capability written afterwards.
  it('refuses every kind of movement against a closed year budget, writing nothing', async () => {
    const b = await makeBudget('1000');
    const em = orm.em.fork();
    const budget = await em.findOneOrFail(Budget, { id: b }, FILTER_OFF);
    budget.status = 'CLOSED';
    await em.flush();

    for (const attempt of [
      () => ledger.reserve(ids.doc, [{ budgetId: b, baseAmount: '10' }]),
      () => ledger.executeAdjustment({ documentId: ids.doc, budgetId: b, amount: '10', movementType: 'ADJUST_INCREASE' }),
    ]) {
      await expect(asUser(attempt)).rejects.toThrow(/closed/i);
    }
    expect(await rows(b)).toHaveLength(0);
  });

  it('names the budget and its year in the refusal', async () => {
    const b = await makeBudget('1000');
    const em = orm.em.fork();
    const budget = await em.findOneOrFail(Budget, { id: b }, FILTER_OFF);
    budget.status = 'CLOSED';
    await em.flush();
    await expect(
      asUser(() => ledger.reserve(ids.doc, [{ budgetId: b, baseAmount: '10' }])),
    ).rejects.toThrow(/2026/);
  });

  it('lets an ACTIVE budget of the same year carry on', async () => {
    const closed = await makeBudget('1000');
    const open = await makeBudget('1000');
    const em = orm.em.fork();
    (await em.findOneOrFail(Budget, { id: closed }, FILTER_OFF)).status = 'CLOSED';
    await em.flush();
    await asUser(() => ledger.reserve(ids.doc, [{ budgetId: open, baseAmount: '10' }]));
    expect(await rows(open)).toHaveLength(1);
  });

  // The parameter is deliberately absent from the availability check: a reservation is made now,
  // and evaluating affordability as of a past date would be a way to spend money since committed.
  it('checks availability against today, with no door to ask as of a past day', async () => {
    const b = await makeBudget('100');
    await at('2026-09-01T02:00:00Z', () =>
      asUser(() => ledger.reserve(ids.doc, [{ budgetId: b, baseAmount: '100' }])),
    );
    // The budget is exhausted as of today. Nothing on `reserve` accepts an as-of date, so there is
    // no way to ask it to evaluate against yesterday's balance.
    await expect(
      at('2026-09-02T02:00:00Z', () =>
        asUser(() => ledger.reserve(ids.doc, [{ budgetId: b, baseAmount: '1' }])),
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('') });
  });
});

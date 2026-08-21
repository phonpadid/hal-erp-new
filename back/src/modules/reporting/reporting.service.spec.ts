import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attachCoverage, budgetAt } from '../../test/budget-fixture';
import { RequestContext } from '../../common/context/request-context';
import { BudgetTxnType, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { materialiseRoute } from '../../test/route-fixture';
import {seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ApproverResolverService } from '../approval/approver-resolver.service';
import { DocumentRouteService } from '../approval/document-route.service';
import { SlaService } from '../approval/sla.service';
import { WorkflowStepResolver } from '../approval/workflow-step.resolver';
import { WorkingTimeService } from '../multi-company/working-time.service';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { Workflow } from '../approval/approval.entities';
import { DeptDocType, Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Vendor } from '../master-data/master-data.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { Currency } from '../currency/currency.entities';
import { ReportingService } from './reporting.service';
import type { MikroORM } from '@mikro-orm/postgresql';

// Fixtures write budget rows directly; `budget_txn.txn_date` is the day of the event and is
// not nullable, so a fixture must state one just as the ledger service does.
const TODAY = new Date().toISOString().slice(0, 10);

const hasDb = await dbAvailable();
// The pending document was submitted 2026-06-01; its current step opened much later.
const SUBMITTED_AT = new Date('2026-06-01T08:00:00Z');
const STEP_OPENED_AT = new Date('2026-06-20T08:00:00Z');
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('reporting service (DB-backed)', () => {
  let orm: MikroORM;
  let reports: ReportingService;
  let companyA = '';
  let deptProcId = '';
  let budgetAId = '';
  let shareDeptId = '';
  let budgetBId = '';
  let requesterId = '';
  let vendorId = '';
  let utilSettledDeptId = '';
  let utilPartialDeptId = '';
  let utilDecreasedDeptId = '';

  const asA = <T>(fn: () => Promise<T>, userId = requesterId) =>
    RequestContext.run({ userId, companyId: companyA, departmentId: deptProcId, grants: [] }, fn);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());

    // Wire the reporting service with the real collaborators it orchestrates.
    const scope = new CompanyScopeService(orm.em);
    const balance = new BudgetBalanceService(orm.em);
    const quotaBalance = new QuotaBalanceService(orm.em);
    const resolver = new ApproverResolverService(orm.em);
    const workingTime = new WorkingTimeService(scope);
    const routeSvc = new DocumentRouteService(orm.em, new WorkflowStepResolver(orm.em), resolver);
    const sla = new SlaService(orm.em, workingTime, resolver, routeSvc);
    reports = new ReportingService(orm.em, scope, balance, quotaBalance, resolver, sla, routeSvc);

    const em = orm.em.fork();
    companyA = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    const dept = await em.findOneOrFail(Department, { company: companyA, deptCode: 'PROC' }, FILTER_OFF);
    deptProcId = dept.id;
    budgetAId = (await em.findOneOrFail(Budget, { glAccount: '5000' }, FILTER_OFF)).id;
    const prType = await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF);
    const mapping = await em.findOneOrFail(
      DeptDocType,
      { department: dept.id, documentType: prType.id },
      { populate: ['formTemplate', 'workflow'], ...FILTER_OFF },
    );
    const requester = await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF);
    requesterId = requester.id;

    // An IN_APPROVAL PR with a RESERVE against budget 5000 (drives balance, aging, audit).
    const doc = em.create(Document, {
      docNo: 'PR-RES-1', company: em.getReference(Company, companyA), department: dept,
      documentType: prType, formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id), createdBy: requester,
      status: DocStatus.IN_APPROVAL, currentStepNo: 1, baseTotalAmount: '250000.00',
      submittedAt: SUBMITTED_AT, createdAt: new Date(),
    });
    await em.flush();
    // The route a submit would have written; the report reads the current step from it. Its clock
    // is set well after `submittedAt` on purpose — time-in-step must be this step's own elapsed
    // time, not the document's age.
    await materialiseRoute(orm, doc.id, 1, STEP_OPENED_AT);
    em.create(BudgetTxn, { budget: em.getReference(Budget, budgetAId), document: doc, txnType: BudgetTxnType.RESERVE, txnDate: TODAY, amount: '250000.00', remark: 'reserve on submit', createdAt: new Date() });
    // A correcting RELEASE — both must remain visible in the audit (append-only).
    em.create(BudgetTxn, { budget: em.getReference(Budget, budgetAId), document: doc, txnType: BudgetTxnType.RELEASE, txnDate: TODAY, amount: '50000.00', remark: 'partial release', createdAt: new Date() });
    await em.flush();

    // An APPROVED PR carrying a vendor + base amount — drives document-summary and spend-by-vendor.
    const vendor = em.create(Vendor, { vendorCode: 'V-RPT-1', name: 'Acme Reporting Co', isActive: true });
    await em.flush();
    vendorId = vendor.id;
    em.create(Document, {
      docNo: 'PR-APR-1', company: em.getReference(Company, companyA), department: dept,
      documentType: prType, formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id), createdBy: requester,
      status: DocStatus.APPROVED, currentStepNo: 1, vendor, baseTotalAmount: '120000.00',
      submittedAt: new Date('2026-06-02T08:00:00Z'), approvedAt: new Date('2026-06-03T08:00:00Z'),
      createdAt: new Date(),
    });
    await em.flush();

    // ── Utilization fixtures ────────────────────────────────────────────────────────────────
    // Three budgets in their own departments, so the assertions above keep their numbers. Each
    // isolates one way `consumed` can be derived wrongly (design D1).
    const fyA = await em.findOneOrFail(FiscalYear, { company: companyA, year: 2026 }, FILTER_OFF);
    const compARef = em.getReference(Company, companyA);
    const utilBudget = (deptCode: string, glAccount: string) => {
      const d = em.create(Department, { company: compARef, deptCode, name: `Util ${deptCode}`, isActive: true });
      const b = budgetAt(em, {
        fiscalYear: fyA, department: d, code: glAccount, glAccount,
        budgetName: `Util ${glAccount}`, amountTotal: '1000000', status: 'ACTIVE',
      });
      attachCoverage(em, compARef, b);
      return { dept: d, budget: b };
    };
    // Their own source document, deliberately not `PR-RES-1`: the budget-audit spec filters that
    // document's movements and asserts the exact pair it carries, so hanging these off it would
    // make an unrelated assertion fail. DRAFT keeps it out of the aging and spend-by-vendor reports.
    const utilDoc = em.create(Document, {
      docNo: 'PR-UTIL-1', company: compARef, department: dept,
      documentType: prType, formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id), createdBy: requester,
      status: DocStatus.DRAFT, currentStepNo: 0, baseTotalAmount: '0.00', createdAt: new Date(),
    });
    const txn = (budget: Budget, txnType: BudgetTxnType, amount: string) =>
      em.create(BudgetTxn, { budget, document: utilDoc, txnType, txnDate: TODAY, amount, createdAt: new Date() });

    // SETTLED: reserve 100k, settle 90k, release the 10k remainder. `reserved + actual` would say
    // 190k — the settled amount counted twice, and more than the budget has ever seen move.
    const settled = utilBudget('UTIL-SETTLED', '5100');
    // PARTIAL: reserve 100k, settle 60k, nothing released yet — 40k still on order. `Σ ACTUAL`
    // would say 60k and lose the outstanding hold.
    const partial = utilBudget('UTIL-PARTIAL', '5200');
    // DECREASED: the budget was cut by 200k and only 50k was ever reserved. `amountTotal −
    // available` would say 250k, counting the cut as if somebody had spent it.
    const decreased = utilBudget('UTIL-DECREASED', '5300');
    await em.flush();
    utilSettledDeptId = settled.dept.id;
    utilPartialDeptId = partial.dept.id;
    utilDecreasedDeptId = decreased.dept.id;

    txn(settled.budget, BudgetTxnType.RESERVE, '100000.00');
    txn(settled.budget, BudgetTxnType.ACTUAL, '90000.00');
    txn(settled.budget, BudgetTxnType.RELEASE, '10000.00');
    txn(partial.budget, BudgetTxnType.RESERVE, '100000.00');
    txn(partial.budget, BudgetTxnType.ACTUAL, '60000.00');
    txn(decreased.budget, BudgetTxnType.ADJUST_DECREASE, '200000.00');
    txn(decreased.budget, BudgetTxnType.RESERVE, '50000.00');
    await em.flush();

    // Two budgets in ONE department, both posting to account 658.0007 — the shape taken straight
    // from the customer's own journal, and the one the old GL grouping merged into a single row.
    const shareDept = em.create(Department, { company: compARef, deptCode: 'SHARE', name: 'Vehicles', isActive: true });
    const fuel = budgetAt(em, { fiscalYear: fyA, department: shareDept, code: '7.1', glAccount: '658.0007', budgetName: 'Fuel', amountTotal: '500000', status: 'ACTIVE' });
    const repairs = budgetAt(em, { fiscalYear: fyA, department: shareDept, code: '7.5', glAccount: '658.0007', budgetName: 'Repairs', amountTotal: '300000', status: 'ACTIVE' });
    attachCoverage(em, compARef, fuel);
    attachCoverage(em, compARef, repairs);
    await em.flush();
    shareDeptId = shareDept.id;

    // A second company with its own '5000' budget — must never leak into company A's reports.
    const thb = await em.findOneOrFail(Currency, { code: 'THB' }, FILTER_OFF);
    const compB = em.create(Company, { code: 'DEMO2', nameTh: 'บีโค', nameEn: 'B Co', taxId: '9', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const deptB = em.create(Department, { company: compB, deptCode: 'PROC', name: 'Proc B', isActive: true });
    const fyB = em.create(FiscalYear, { company: compB, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const budgetB = budgetAt(em, { fiscalYear: fyB, department: deptB, code: '5000', glAccount: '5000', budgetName: 'B budget', amountTotal: '500000', status: 'ACTIVE' });
    attachCoverage(em, compB, budgetB);
    await em.flush();
    budgetBId = budgetB.id;
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('budget-balance groups by dept/category, reflects the ledger, and never leaks another company', async () => {
    const { rows, groups } = await asA(() => reports.budgetBalanceByDeptCategory());
    // Only company A's budget appears.
    expect(rows.map((r) => r.budgetId)).toContain(budgetAId);
    expect(rows.map((r) => r.budgetId)).not.toContain(budgetBId);

    const g = groups.find((x) => x.departmentId === deptProcId && x.category === '5000');
    expect(g).toBeDefined();
    // 1,000,000 total; reserved 250,000; released 50,000 → available 800,000 (derived, not stored).
    expect(Number(g!.amountTotal)).toBe(1_000_000);
    expect(Number(g!.reserved)).toBe(250_000);
    expect(Number(g!.released)).toBe(50_000);
    expect(Number(g!.available)).toBe(800_000);
  });

  it('keeps two budgets that share one account as two rows', async () => {
    // Task 8.2. Grouped by GL account these were one row reading 800,000, which matches nothing in
    // the customer's plan: their book has a fuel line and a repairs line, each with its own figure.
    const { rows, groups } = await asA(() => reports.budgetBalanceByDeptCategory());
    const mine = rows.filter((r) => r.departmentId === shareDeptId);
    expect(mine.map((r) => r.category).sort()).toEqual(['7.1', '7.5']);

    const mineGroups = groups.filter((g) => g.departmentId === shareDeptId);
    expect(mineGroups).toHaveLength(2);
    expect(mineGroups.map((g) => Number(g.amountTotal)).sort((a, b) => a - b)).toEqual([300_000, 500_000]);
  });

  it('approval-aging lists the pending doc even for its own creator (not an inbox)', async () => {
    // Run AS the requester (who created PR-RES-1) — an inbox would hide it (self-approval).
    const { rows, byStep } = await asA(() => reports.approvalAging());
    const row = rows.find((r) => r.docNo === 'PR-RES-1');
    expect(row).toBeDefined();
    expect(row!.currentStepNo).toBe(1);
    expect(row!.ageHours).not.toBeNull();
    // Step roll-up counts the pending document under its current step.
    expect(byStep.find((s) => s.stepNo === 1)?.pendingCount).toBeGreaterThanOrEqual(1);
  });

  // Time-in-step used to be inferred from the latest approval-log row at or below the current step,
  // falling back to the submit time — so a document that had sat on step 1 since it was submitted
  // reported its whole age as time-in-step. It is now the step's own `started_at`.
  it('approval-aging reports the current step\'s own elapsed time, not the document age', async () => {
    const { rows } = await asA(() => reports.approvalAging());
    const row = rows.find((r) => r.docNo === 'PR-RES-1')!;
    const ageFromSubmit = (Date.now() - SUBMITTED_AT.getTime()) / 3_600_000;
    const ageFromStep = (Date.now() - STEP_OPENED_AT.getTime()) / 3_600_000;
    expect(row.timeInStepHours).toBeCloseTo(ageFromStep, 0);
    expect(row.timeInStepHours).toBeLessThan(ageFromSubmit - 400); // ~19 days apart
  });

  it('quota-remaining returns per-person remaining for the active company', async () => {
    const rows = await asA(() => reports.quotaRemaining());
    const leave = rows.find((r) => r.quotaType === 'ANNUAL_LEAVE');
    expect(leave).toBeDefined();
    expect(Number(leave!.entitled)).toBe(12);
    expect(Number(leave!.remaining)).toBe(12); // no usage recorded
  });

  it('budget-audit lists movements with the source document, corrections included', async () => {
    const rows = await asA(() => reports.budgetAudit());
    const mine = rows.filter((r) => r.documentNo === 'PR-RES-1');
    // Both the RESERVE and the correcting RELEASE are present (append-only, nothing merged).
    expect(mine.map((r) => r.txnType).sort()).toEqual(['RELEASE', 'RESERVE']);
    expect(mine.every((r) => r.category === '5000')).toBe(true);
    // No company-B movement appears.
    expect(rows.every((r) => r.budgetId !== budgetBId)).toBe(true);
  });

  it('budget-audit date filter narrows the set', async () => {
    const future = await asA(() => reports.budgetAudit({ from: '2999-01-01' }));
    expect(future.length).toBe(0);
  });

  it('document-summary counts by type × status with base totals, and per-status totals', async () => {
    const { rows, byStatus } = await asA(() => reports.documentSummary());
    // PR × IN_APPROVAL (PR-RES-1) and PR × APPROVED (PR-APR-1) are distinct cells.
    const inApproval = rows.find((r) => r.typeCode === 'PR' && r.status === DocStatus.IN_APPROVAL);
    const approved = rows.find((r) => r.typeCode === 'PR' && r.status === DocStatus.APPROVED);
    expect(inApproval?.count).toBeGreaterThanOrEqual(1);
    expect(Number(inApproval!.baseTotal)).toBeGreaterThanOrEqual(250_000);
    expect(approved?.count).toBeGreaterThanOrEqual(1);
    expect(Number(approved!.baseTotal)).toBeGreaterThanOrEqual(120_000);
    // Per-status donut source includes both statuses.
    expect(byStatus.map((s) => s.status)).toEqual(expect.arrayContaining([DocStatus.IN_APPROVAL, DocStatus.APPROVED]));
  });

  it('document-summary does not 500 when a document type cannot be resolved', async () => {
    // Reproduce the real-world dirty-data condition behind the reported 500: a document whose
    // document_type_id has no matching document_type row. The FK normally forbids this, so drop
    // that one constraint and orphan a fresh document's type id, then confirm the report still
    // returns rows (the orphan row degrades to a fallback type code instead of throwing).
    const em = orm.em.fork();
    const dept = await em.findOneOrFail(Department, { id: deptProcId }, FILTER_OFF);
    const prType = await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF);
    const mapping = await em.findOneOrFail(
      DeptDocType,
      { department: deptProcId, documentType: prType.id },
      { populate: ['formTemplate', 'workflow'], ...FILTER_OFF },
    );
    const requester = await em.findOneOrFail(AppUser, { id: requesterId }, FILTER_OFF);
    const orphan = em.create(Document, {
      docNo: 'PR-ORPH-1', company: em.getReference(Company, companyA), department: dept,
      documentType: prType, formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id), createdBy: requester,
      status: DocStatus.APPROVED, currentStepNo: 1, baseTotalAmount: '99.00', createdAt: new Date(),
    });
    await em.flush();

    const conn = em.getConnection();
    await conn.execute('alter table "document" drop constraint if exists "document_document_type_id_foreign"');
    await conn.execute(
      `update "document" set document_type_id = '00000000-0000-0000-0000-000000000000' where id = ?`,
      [orphan.id],
    );

    // Before the fix this threw a TypeError (→ HTTP 500). Now it resolves with rows.
    const { rows } = await asA(() => reports.documentSummary());
    const orphanRow = rows.find((r) => r.documentTypeId === '00000000-0000-0000-0000-000000000000');
    expect(orphanRow).toBeDefined();
    expect(typeof orphanRow!.typeCode).toBe('string'); // defined fallback, not undefined
    expect(orphanRow!.count).toBeGreaterThanOrEqual(1);
  });

  it('spend-by-vendor sums locked base amounts for committed docs, cumulative reaches 100', async () => {
    const rows = await asA(() => reports.spendByVendor());
    const acme = rows.find((r) => r.vendorId === vendorId);
    expect(acme).toBeDefined();
    expect(acme!.vendorName).toBe('Acme Reporting Co'); // populate('vendor') must hydrate the name, not leave a bare ref
    expect(Number(acme!.baseTotal)).toBe(120_000); // only the APPROVED doc, the IN_APPROVAL one is excluded
    // Pareto: the last (least) row's running share is 100%.
    expect(rows[rows.length - 1].cumulativePct).toBe(100);
  });

  it('budget-utilization reconciles to the budget-balance groups (consumed = reserved − released)', async () => {
    const rows = await asA(() => reports.budgetUtilization());
    const proc = rows.find((r) => r.departmentId === deptProcId);
    expect(proc).toBeDefined();
    // total 1,000,000; reserved 250,000, released 50,000 → consumed 200,000, utilization 20.0%.
    // The release is why this is not 250,000: money given back was never consumed.
    expect(Number(proc!.amountTotal)).toBe(1_000_000);
    expect(Number(proc!.consumed)).toBe(200_000);
    expect(proc!.utilizationPct).toBe(20);
  });

  it('budget-utilization counts a settled document once, not twice', async () => {
    const rows = await asA(() => reports.budgetUtilization());
    const row = rows.find((r) => r.departmentId === utilSettledDeptId);
    expect(row).toBeDefined();
    // reserve 100,000 → actual 90,000 + release 10,000. ACTUAL draws down the reservation that
    // already reduced the balance, so consumed is 90,000 — `reserved + actual` would say 190,000.
    expect(Number(row!.consumed)).toBe(90_000);
    expect(row!.utilizationPct).toBe(9);
  });

  it('budget-utilization counts an outstanding reservation as consumed', async () => {
    const rows = await asA(() => reports.budgetUtilization());
    const row = rows.find((r) => r.departmentId === utilPartialDeptId);
    expect(row).toBeDefined();
    // reserve 100,000, settled 60,000, 40,000 still on order and not released. All 100,000 is out
    // of the budget — `Σ ACTUAL` would say 60,000 and lose the hold.
    expect(Number(row!.consumed)).toBe(100_000);
    expect(row!.utilizationPct).toBe(10);
  });

  it('budget-utilization does not count an adjustment as consumption', async () => {
    const rows = await asA(() => reports.budgetUtilization());
    const row = rows.find((r) => r.departmentId === utilDecreasedDeptId);
    expect(row).toBeDefined();
    // amount_total 1,000,000 cut by 200,000, with 50,000 reserved → available 750,000.
    // `amountTotal − available` would say 250,000: the cut is money removed from the budget that
    // nobody consumed (design D1).
    expect(Number(row!.available)).toBe(750_000);
    expect(Number(row!.consumed)).toBe(50_000);
  });

  it('budget-utilization has consumed + available equal amount_total when nothing was adjusted', async () => {
    const rows = await asA(() => reports.budgetUtilization());
    for (const deptId of [deptProcId, utilSettledDeptId, utilPartialDeptId]) {
      const row = rows.find((r) => r.departmentId === deptId);
      expect(row).toBeDefined();
      // The reconciliation the old formula broke: consumed and available are two halves of the
      // same opening amount, so they must add back up to it.
      expect(Number(row!.consumed) + Number(row!.available)).toBe(Number(row!.amountTotal));
    }
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[reporting] no database reachable — skipping DB-backed spec');
}

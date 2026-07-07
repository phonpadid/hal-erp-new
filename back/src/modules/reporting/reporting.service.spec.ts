import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { BudgetTxnType, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { seedDatabase } from '../../seed/seed-data';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ApproverResolverService } from '../approval/approver-resolver.service';
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

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('reporting service (DB-backed)', () => {
  let orm: MikroORM;
  let reports: ReportingService;
  let companyA = '';
  let deptProcId = '';
  let budgetAId = '';
  let budgetBId = '';
  let requesterId = '';
  let vendorId = '';

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
    const sla = new SlaService(orm.em, workingTime, resolver, new WorkflowStepResolver(orm.em));
    reports = new ReportingService(orm.em, scope, balance, quotaBalance, resolver, sla);

    const em = orm.em.fork();
    companyA = (await em.findOneOrFail(Company, { code: 'DEMO' }, FILTER_OFF)).id;
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
      submittedAt: new Date('2026-06-01T08:00:00Z'), createdAt: new Date(),
    });
    await em.flush();
    em.create(BudgetTxn, { budget: em.getReference(Budget, budgetAId), document: doc, txnType: BudgetTxnType.RESERVE, amount: '250000.00', remark: 'reserve on submit', createdAt: new Date() });
    // A correcting RELEASE — both must remain visible in the audit (append-only).
    em.create(BudgetTxn, { budget: em.getReference(Budget, budgetAId), document: doc, txnType: BudgetTxnType.RELEASE, amount: '50000.00', remark: 'partial release', createdAt: new Date() });
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

    // A second company with its own '5000' budget — must never leak into company A's reports.
    const thb = await em.findOneOrFail(Currency, { code: 'THB' }, FILTER_OFF);
    const compB = em.create(Company, { code: 'DEMO2', nameTh: 'บีโค', nameEn: 'B Co', taxId: '9', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const deptB = em.create(Department, { company: compB, deptCode: 'PROC', name: 'Proc B', isActive: true });
    const fyB = em.create(FiscalYear, { company: compB, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const budgetB = em.create(Budget, { fiscalYear: fyB, department: deptB, glAccount: '5000', budgetName: 'B budget', amountTotal: '500000', status: 'ACTIVE' });
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

  it('budget-utilization reconciles to the budget-balance groups (consumed = reserved + actual)', async () => {
    const rows = await asA(() => reports.budgetUtilization());
    const proc = rows.find((r) => r.departmentId === deptProcId);
    expect(proc).toBeDefined();
    // total 1,000,000; reserved 250,000, actual 0 → consumed 250,000, utilization 25.0%.
    expect(Number(proc!.amountTotal)).toBe(1_000_000);
    expect(Number(proc!.consumed)).toBe(250_000);
    expect(proc!.utilizationPct).toBe(25);
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[reporting] no database reachable — skipping DB-backed spec');
}

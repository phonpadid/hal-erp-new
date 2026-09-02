import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { budgetAt } from '../../test/budget-fixture';
import { BudgetTxnType } from '../../common/enums';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { ApproverResolverService } from '../approval/approver-resolver.service';
import { DocumentRouteService } from '../approval/document-route.service';
import { WorkflowStepResolver } from '../approval/workflow-step.resolver';
import { SlaService } from '../approval/sla.service';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { WorkingTimeService } from '../multi-company/working-time.service';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { Workflow } from '../approval/approval.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { AppUser } from '../rbac/rbac.entities';
import { ReportingService } from './reporting.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The budget audit report answers date questions with the day the movement HAPPENED.
 *
 * Before `budget_txn.txn_date` it could only answer with the insert time, so a transfer effective on
 * 1 May and approved on the 20th filed itself under the 20th — and a person asking for the first
 * half of May did not see it. The general ledger has always answered this way, with `entry_date`.
 *
 * Its own company, because the report aggregates company-wide: a row added to a shared fixture
 * changes the answers of every other test reading the same totals.
 */
describe.skipIf(!hasDb)('budget audit is dated by the event (DB-backed)', () => {
  let orm: MikroORM;
  let reports: ReportingService;
  const ids = { company: '', dept: '', fy: '', budget: '', doc: '' };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const company = em.create(Company, {
      code: 'AUD', nameTh: 'Audit Co', taxId: '1', branchCode: '00000',
      timezone: 'Asia/Bangkok', isActive: true,
    });
    const dept = em.create(Department, { company, deptCode: 'D', name: 'D', isActive: true });
    const fy = em.create(FiscalYear, { company, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const budget = budgetAt(em, {
      fiscalYear: fy, department: dept, code: '5000', glAccount: '5000', amountTotal: '100000.00', status: 'ACTIVE',
    });
    // `budget_txn.document` is not nullable — every movement is raised by one.
    const user = em.create(AppUser, { username: 'aud-user', email: 'aud@x', status: 'ACTIVE' });
    const dt = em.create(DocumentType, {
      company, code: 'AUDADJ', name: 'Adjustment', category: 'FINANCE' as never,
      requiresBudget: false, requiresQuota: false, isActive: true,
    });
    const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
    const wf = em.create(Workflow, { company, name: 'AUD WF', isActive: true });
    const doc = em.create(Document, {
      docNo: 'AUD-1', company, department: dept, documentType: dt, formTemplate: tmpl, workflow: wf,
      currentStepNo: 0, createdBy: user, exchangeRate: '1', status: 'COMPLETED' as never, createdAt: new Date(),
    });
    await em.flush();
    Object.assign(ids, { company: company.id, dept: dept.id, fy: fy.id, budget: budget.id, doc: doc.id });

    // Two movements: one that took effect in early May and was recorded now, and one whose day and
    // recording agree. Only the first can tell the two readings apart.
    const em2 = orm.em.fork();
    em2.create(BudgetTxn, {
      budget: em2.getReference(Budget, ids.budget),
      document: em2.getReference(Document, ids.doc),
      txnType: BudgetTxnType.ADJUST_INCREASE,
      txnDate: '2026-05-01',
      amount: '1000.00',
      remark: 'effective early May, recorded later',
      createdAt: new Date(),
    });
    em2.create(BudgetTxn, {
      budget: em2.getReference(Budget, ids.budget),
      document: em2.getReference(Document, ids.doc),
      txnType: BudgetTxnType.ADJUST_INCREASE,
      txnDate: '2026-08-20',
      amount: '2000.00',
      remark: 'august',
      createdAt: new Date(),
    });
    await em2.flush();

    const em3 = orm.em.fork();
    const scope = new CompanyScopeService(em3);
    const resolver = new ApproverResolverService(em3);
    const routeSvc = new DocumentRouteService(em3, new WorkflowStepResolver(em3), resolver);
    const sla = new SlaService(em3, new WorkingTimeService(scope), resolver, routeSvc);
    reports = new ReportingService(
      em3, scope, new BudgetBalanceService(em3), new QuotaBalanceService(em3), resolver, sla, routeSvc,
    );
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  const asA = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: undefined, companyId: ids.company, departmentId: ids.dept, grants: [] }, fn);

  it('files a backdated movement under the day it took effect', async () => {
    const rows = await asA(() => reports.budgetAudit({ from: '2026-05-01', to: '2026-05-15' }));
    expect(rows.map((r) => r.remark)).toEqual(['effective early May, recorded later']);
    expect(rows[0].txnDate).toBe('2026-05-01');
    // Both times are reported: when it happened, and when the system learned of it.
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it('excludes a movement whose day falls outside the range', async () => {
    const rows = await asA(() => reports.budgetAudit({ from: '2026-06-01', to: '2026-06-30' }));
    expect(rows).toHaveLength(0);
  });

  it('orders by the day it happened, newest first', async () => {
    const rows = await asA(() => reports.budgetAudit());
    expect(rows.map((r) => r.txnDate)).toEqual(['2026-08-20', '2026-05-01']);
  });
});

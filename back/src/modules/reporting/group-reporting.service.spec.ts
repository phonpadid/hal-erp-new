import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { BudgetTxnType, DocStatus, Scope } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { seedDatabase } from '../../seed/seed-data';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ApproverResolverService } from '../approval/approver-resolver.service';
import { SlaService } from '../approval/sla.service';
import { WorkflowStepResolver } from '../approval/workflow-step.resolver';
import { WorkingTimeService } from '../multi-company/working-time.service';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { ScopeService } from '../rbac/scope.service';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { Workflow } from '../approval/approval.entities';
import { DeptDocType, Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { Currency } from '../currency/currency.entities';
import { AppUser } from '../rbac/rbac.entities';
import { ReportingService } from './reporting.service';
import { GroupReportingService } from './group-reporting.service';
import type { Grant } from '../../auth/jwt-payload.interface';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;
const GROUP_GRANT: Grant[] = [{ code: 'REPORT_GROUP_VIEW', scope: Scope.GROUP }];

describe.skipIf(!hasDb)('group reporting: consolidated budget balance (DB-backed)', () => {
  let orm: MikroORM;
  let group: GroupReportingService;
  let companyAId = '';
  let requesterId = '';

  const runAs = <T>(grants: Grant[], fn: () => Promise<T>) =>
    RequestContext.run({ userId: requesterId, companyId: companyAId, departmentId: '', grants }, fn);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());

    const scope = new CompanyScopeService(orm.em);
    const balance = new BudgetBalanceService(orm.em);
    const quotaBalance = new QuotaBalanceService(orm.em);
    const resolver = new ApproverResolverService(orm.em);
    const sla = new SlaService(orm.em, new WorkingTimeService(scope), resolver, new WorkflowStepResolver(orm.em));
    const reporting = new ReportingService(orm.em, scope, balance, quotaBalance, resolver, sla);
    const fx = new ExchangeRateService(orm.em);
    group = new GroupReportingService(scope, new ScopeService(), reporting, fx);

    const em = orm.em.fork();
    const compA = await em.findOneOrFail(Company, { code: 'DEMO' }, FILTER_OFF);
    companyAId = compA.id;
    const dept = await em.findOneOrFail(Department, { company: companyAId, deptCode: 'PROC' }, FILTER_OFF);
    const budgetA = await em.findOneOrFail(Budget, { glAccount: '5000' }, FILTER_OFF); // THB 1,000,000
    const prType = await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF);
    const mapping = await em.findOneOrFail(DeptDocType, { department: dept.id, documentType: prType.id }, { populate: ['formTemplate', 'workflow'], ...FILTER_OFF });
    const requester = await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF);
    requesterId = requester.id;

    // Company A: reserve 250,000 THB → native available 750,000 THB (THB is the presentation cur).
    const doc = em.create(Document, {
      docNo: 'PR-G-1', company: em.getReference(Company, companyAId), department: dept,
      documentType: prType, formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id), createdBy: requester,
      status: DocStatus.IN_APPROVAL, currentStepNo: 1, baseTotalAmount: '250000.00',
      submittedAt: new Date('2026-06-01T08:00:00Z'), createdAt: new Date(),
    });
    await em.flush();
    em.create(BudgetTxn, { budget: em.getReference(Budget, budgetA.id), document: doc, txnType: BudgetTxnType.RESERVE, amount: '250000.00', createdAt: new Date() });

    const usd = await em.findOneOrFail(Currency, { code: 'USD' }, FILTER_OFF);
    const jpy = await em.findOneOrFail(Currency, { code: 'JPY' }, FILTER_OFF);

    // Company B (USD base): budget 1,000 USD, no txns → available 1,000 USD; GROUP USD→THB=35 (seeded).
    const compB = em.create(Company, { code: 'GRP-B', nameTh: 'บีโค', nameEn: 'B Co', taxId: '21', branchCode: '00000', baseCurrency: usd, isActive: true, createdAt: new Date() });
    const deptB = em.create(Department, { company: compB, deptCode: 'PROC', name: 'Proc B', isActive: true });
    const fyB = em.create(FiscalYear, { company: compB, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    em.create(Budget, { fiscalYear: fyB, department: deptB, glAccount: '5000', budgetName: 'B', amountTotal: '1000', status: 'ACTIVE' });

    // Company C (JPY base): no JPY→THB rate exists → unconvertible.
    const compC = em.create(Company, { code: 'GRP-C', nameTh: 'ซีโค', nameEn: 'C Co', taxId: '22', branchCode: '00000', baseCurrency: jpy, isActive: true, createdAt: new Date() });
    const deptC = em.create(Department, { company: compC, deptCode: 'PROC', name: 'Proc C', isActive: true });
    const fyC = em.create(FiscalYear, { company: compC, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    em.create(Budget, { fiscalYear: fyC, department: deptC, glAccount: '5000', budgetName: 'C', amountTotal: '50000', status: 'ACTIVE' });

    await em.flush();
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('consolidates every company into the presentation currency at the GROUP rate', async () => {
    const res = await runAs(GROUP_GRANT, () => group.consolidatedBudgetBalance({ currency: 'THB', asOf: '2026-06-29' }));
    expect(res.currency).toBe('THB');

    const a = res.companies.find((c) => c.companyCode === 'DEMO')!;
    expect(a.rateSource).toBe('IDENTITY'); // THB→THB
    expect(Number(a.convertedTotal!.available)).toBe(750_000);

    const b = res.companies.find((c) => c.companyCode === 'GRP-B')!;
    expect(b.baseCurrency).toBe('USD');
    expect(Number(b.rate)).toBe(35);
    expect(b.rateSource).toBe('GROUP');
    expect(Number(b.convertedTotal!.available)).toBe(35_000); // 1,000 USD × 35

    // Group total (THB) sums the convertible companies: A 750,000 + B 35,000.
    expect(Number(res.groupTotal.available)).toBe(785_000);
  });

  it('reports a company with no resolvable rate as unconvertible, excluded from the total', async () => {
    const res = await runAs(GROUP_GRANT, () => group.consolidatedBudgetBalance({ currency: 'THB', asOf: '2026-06-29' }));
    const c = res.companies.find((x) => x.companyCode === 'GRP-C')!;
    expect(c.convertible).toBe(false);
    expect(c.convertedTotal).toBeNull();
    expect(Number(c.nativeTotal.available)).toBe(50_000); // native JPY total still shown
    // C is excluded from the group total (785,000 has no JPY contribution).
    expect(Number(res.groupTotal.available)).toBe(785_000);
  });

  it('refuses a caller not holding REPORT_GROUP_VIEW at GROUP scope', async () => {
    const companyScoped: Grant[] = [{ code: 'REPORT_GROUP_VIEW', scope: Scope.COMPANY }];
    await expect(runAs(companyScoped, () => group.consolidatedBudgetBalance({ currency: 'THB' }))).rejects.toThrow();
    await expect(runAs([{ code: 'REPORT_VIEW', scope: Scope.GROUP }], () => group.consolidatedBudgetBalance({ currency: 'THB' }))).rejects.toThrow();
  });

  it('writes no ledger row and changes no budget amount_total (presentation-only)', async () => {
    const fork = orm.em.fork();
    const txnsBefore = await fork.count(BudgetTxn, {}, FILTER_OFF);
    const totalBefore = (await fork.findOneOrFail(Budget, { glAccount: '5000', fiscalYear: { company: companyAId } }, FILTER_OFF)).amountTotal;

    await runAs(GROUP_GRANT, () => group.consolidatedBudgetBalance({ currency: 'THB', asOf: '2026-06-29' }));

    const fork2 = orm.em.fork();
    expect(await fork2.count(BudgetTxn, {}, FILTER_OFF)).toBe(txnsBefore);
    expect((await fork2.findOneOrFail(Budget, { glAccount: '5000', fiscalYear: { company: companyAId } }, FILTER_OFF)).amountTotal).toBe(totalBefore);
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[group-reporting] no database reachable — skipping DB-backed spec');
}

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { BudgetTxnType, DocCategory, DocStatus } from '../../common/enums';
import { budgetAt } from '../../test/budget-fixture';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { Workflow } from '../approval/approval.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { AppUser } from '../rbac/rbac.entities';
import { BudgetQuarterService } from './budget-quarter.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The quarterly report counted budgets that had been turned down.
 *
 * On the customer's data, `ພະແນກບໍລິຫານ` read as a 1,792,800,000 department when it held
 * 1,092,800,000: plan line `1.101` existed three times — once ACTIVE, twice REJECTED at 350,000,000
 * apiece — so the report listed it three times and put 700,000,000 of refused proposals into the
 * ceiling. Every utilisation figure derived from that ceiling was understated.
 *
 * `REJECTED` is kept rather than deleted because `budget_movement.to_budget_id` references it and
 * because the record of what was refused is the point of routing budgets through approval at all.
 * It is a record of a decision. It is not money.
 *
 * The fixture below is the customer's exact shape.
 */
describe.skipIf(!hasDb)('the quarterly report counts only budgets that are money (DB-backed)', () => {
  let orm: MikroORM;
  let quarters: BudgetQuarterService;
  const ids = { company: '', fy: '', adm: '', refusedOnly: '', active: '' };

  const asA = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ companyId: ids.company, departmentId: ids.adm, userId: 'u', grants: [] }, fn);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();

    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const adm = em.create(Department, { company, deptCode: 'ADM', name: 'Administration', isActive: true });
    // A department whose only budgets were refused — it must not be offered a report at all.
    const refusedOnly = em.create(Department, { company, deptCode: 'RF', name: 'Refused only', isActive: true });
    const fy = em.create(FiscalYear, { company, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });

    // The customer's shape: one plan code, three budgets, one of them in force.
    const active = budgetAt(em, { fiscalYear: fy, department: adm, code: '1.101', budgetName: 'In force', amountTotal: '350000000.00', status: 'ACTIVE' });
    budgetAt(em, { fiscalYear: fy, department: adm, code: '1.101-r1', budgetName: 'Refused', amountTotal: '350000000.00', status: 'REJECTED' });
    budgetAt(em, { fiscalYear: fy, department: adm, code: '1.101-r2', budgetName: 'Refused', amountTotal: '350000000.00', status: 'REJECTED' });
    // Still waiting for the approval that would put it in force.
    budgetAt(em, { fiscalYear: fy, department: adm, code: '1.102', budgetName: 'Proposed', amountTotal: '99000000.00', status: 'DRAFT' });
    // A status no declared list contains — reachable because the update DTO takes any string and
    // the edit form offers it. The case a deny-list would have admitted.
    budgetAt(em, { fiscalYear: fy, department: adm, code: '1.103', budgetName: 'Deactivated', amountTotal: '77000000.00', status: 'INACTIVE' });
    budgetAt(em, { fiscalYear: fy, department: refusedOnly, code: '2.101', budgetName: 'Refused', amountTotal: '1000.00', status: 'REJECTED' });

    // A ledger row needs a document to have come from, so the minimum that makes one legal.
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    const dt = em.create(DocumentType, {
      company, code: 'PR', name: 'PR', category: DocCategory.PROCUREMENT,
      requiresBudget: true, requiresQuota: false, isActive: true,
    } as never);
    const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
    const doc = em.create(Document, {
      docNo: 'PR-1', company, department: adm, documentType: dt, formTemplate: tmpl, workflow: wf,
      createdBy: user, status: DocStatus.DRAFT, currentStepNo: 0, baseTotalAmount: '0.00',
      createdAt: new Date(),
    } as never);

    // Consumption on the budget that IS counted, so the figures have something to measure.
    em.create(BudgetTxn, {
      budget: active, document: doc, txnType: BudgetTxnType.RESERVE,
      amount: '50000000.00', txnDate: '2026-02-10', createdAt: new Date(),
    } as never);

    await em.persistAndFlush(company);
    Object.assign(ids, { company: company.id, fy: fy.id, adm: adm.id, refusedOnly: refusedOnly.id, active: active.id });
    quarters = new BudgetQuarterService(orm.em);
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  /** The one department row the report produces for ADM. */
  const admRow = async () => {
    const res = await asA(() => quarters.byQuarter(ids.fy, ids.adm));
    return { res, dept: res.departments[0] };
  };

  it('leaves a refused proposal out of the annual budget', async () => {
    const { dept } = await admRow();
    // 350,000,000 — not 1,050,000,000, and not 1,176,000,000 with the draft and the deactivated.
    expect(dept.amountTotal).toBe('350000000');
  });

  it('does not list a refused proposal as a row', async () => {
    const { dept } = await admRow();
    const codes = dept.budgets.map((b) => b.code).sort();
    expect(codes).toEqual(['1.101']);
  });

  it('leaves a DRAFT out too — it is not spendable yet', async () => {
    const { dept } = await admRow();
    expect(dept.budgets.map((b) => b.code)).not.toContain('1.102');
  });

  it('leaves out a status no declared list contains', async () => {
    // `INACTIVE` is in neither `BUDGET_STATUSES` nor the counted set. A rule written as exclusions
    // would have admitted it today, not hypothetically — which is why the rule is an allow-list.
    const { dept } = await admRow();
    expect(dept.budgets.map((b) => b.code)).not.toContain('1.103');
  });

  it('does not move the consumption of the budgets it does count', async () => {
    // The change moves the ceiling, never the ledger. Q1 holds the one RESERVE.
    const { dept } = await admRow();
    const q1 = dept.quarters[0];
    expect(q1.consumed).toBe('50000000');
  });

  it('reports how many budgets it left out, and what they were worth', async () => {
    const { res } = await admRow();
    // Two refused at 350,000,000, one draft at 99,000,000, one deactivated at 77,000,000.
    expect(res.excluded).toEqual({ count: 4, amountTotal: '876000000' });
  });

  it('reports nothing when nothing was excluded', async () => {
    // Absence of a fact, not a fact: a zeroed object here would invite the reader to wonder what
    // is missing when nothing is.
    const em = orm.em.fork();
    for (const b of await em.find(Budget, { fiscalYear: ids.fy }, FILTER_OFF)) {
      if (b.status !== 'ACTIVE') b.status = 'ACTIVE';
    }
    await em.flush();

    const res = await asA(() => quarters.byQuarter(ids.fy, ids.adm));
    expect(res.excluded).toBeNull();

    // put it back for any test that runs after
    const back = orm.em.fork();
    const rows = await back.find(Budget, { fiscalYear: ids.fy }, FILTER_OFF);
    for (const b of rows) if (b.id !== ids.active) b.status = 'REJECTED';
    await back.flush();
  });

  it('does not offer a department whose every budget was refused', async () => {
    // A filter must never offer an option that yields a report with no money in it.
    const res = await asA(() => quarters.byQuarter(ids.fy));
    expect(res.departmentOptions.map((d) => d.name)).toEqual(['Administration']);
  });

  it('still scopes to the active company with the status filter applied', async () => {
    const other = orm.em.fork();
    const b = other.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', isActive: true } as never);
    await other.persistAndFlush(b);
    // Company B has no fiscal year of its own, so asking for A's year from B's context must not
    // resolve it — company scope reaches this read through `fiscalYear` and the status predicate
    // narrows that, never replaces it.
    await expect(
      RequestContext.run(
        { companyId: (b as { id: string }).id, departmentId: ids.adm, userId: 'u', grants: [] },
        () => quarters.byQuarter(ids.fy),
      ),
    ).rejects.toThrow();
  });
});

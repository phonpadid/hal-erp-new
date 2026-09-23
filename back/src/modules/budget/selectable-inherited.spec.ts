import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocCategory, DocStatus, Scope } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AccountService } from '../accounting/account.service';
import { Workflow } from '../approval/approval.entities';
import { Document, DocumentLine, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetService } from './budget.service';
import { Budget, BudgetNode } from './budget.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

/**
 * A successor keeps the budgets it inherited, whoever completes it.
 *
 * A PR raised in ADM charges ADM's budget; the PO raised from it in Procurement carries that budget
 * on every line, and the server accepts it — control points govern through the BUDGET's department.
 * Only the picker refused: it offered Procurement's budgets, found ADM's missing, and called the
 * line lost. The read now takes the draft being edited and offers back what its lines carry — that
 * and nothing more of ADM's.
 */
describe.skipIf(!hasDb)('inherited budgets stay selectable (DB-backed)', () => {
  let orm: MikroORM;
  let budgets: BudgetService;
  const ids = {
    company: '', other: '', adm: '', proc: '', otherDept: '', user: '',
    admNamed: '', admOther: '', admRetired: '', procOwn: '', foreign: '',
    poType: '', poTmpl: '', wf: '', poFromAdm: '', poWithOwn: '', poWithRetired: '', foreignDoc: '',
  };
  let seq = 0;

  const asProc = <T>(fn: () => Promise<T>) =>
    RequestContext.run(
      { companyId: ids.company, departmentId: ids.proc, userId: ids.user, grants: [{ code: 'DOC_CREATE', scope: Scope.DEPARTMENT }] },
      fn,
    );

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();

    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const other = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', isActive: true });
    const adm = em.create(Department, { company, deptCode: 'ADM', name: 'Administration', isActive: true });
    // Procurement hangs under ADM in the org tree — which, deliberately, buys it nothing here.
    const proc = em.create(Department, { company, deptCode: 'PROC', name: 'Procurement', isActive: true, parentDept: adm });
    const otherDept = em.create(Department, { company: other, deptCode: 'BD', name: 'B dept', isActive: true });
    const fy = em.create(FiscalYear, { company, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const fyOther = em.create(FiscalYear, { company: other, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const user = em.create(AppUser, { username: 'buyer', email: 'buyer@x', status: 'ACTIVE' });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    const poType = em.create(DocumentType, { company, code: 'PO', name: 'PO', category: DocCategory.PROCUREMENT, requiresBudget: true, requiresQuota: false, isActive: true });
    const poTmpl = em.create(FormTemplate, { documentType: poType, version: 1, status: 'PUBLISHED' });

    const node = (code: string, name: string, fiscalYear = fy) => em.create(BudgetNode, { fiscalYear, code, name });
    const budget = (n: BudgetNode, department: Department, status = 'ACTIVE', fiscalYear = fy) =>
      em.create(Budget, { fiscalYear, department, node: n, amountTotal: '1000000', status });
    const admNamed = budget(node('1.101', 'Drinking water'), adm);      // what the PR named
    const admOther = budget(node('1.102', 'Office supplies'), adm);     // ADM's, never named
    const admRetired = budget(node('1.103', 'Old contract'), adm, 'CLOSED');
    const procOwn = budget(node('2.101', 'Tender costs'), proc);
    const foreign = budget(node('9', 'B plan', fyOther), otherDept, 'ACTIVE', fyOther);

    const doc = (department: Department, company_: Company, budgetsOnLines: Budget[]) => {
      const d = em.create(Document, {
        docNo: `PO-${seq++}`, company: company_, department, documentType: poType, formTemplate: poTmpl,
        workflow: wf, currentStepNo: 0, createdBy: user, exchangeRate: '1', status: DocStatus.DRAFT, createdAt: new Date(),
      });
      budgetsOnLines.forEach((b, i) =>
        em.create(DocumentLine, { document: d, lineNo: i + 1, description: 'x', qty: '1', unitPrice: '10', lineAmount: '10', budget: b }),
      );
      return d;
    };
    const poFromAdm = doc(proc, company, [admNamed]);
    const poWithOwn = doc(proc, company, [procOwn]);
    const poWithRetired = doc(proc, company, [admRetired]);
    const foreignDoc = doc(otherDept, other, [foreign]);

    await em.flush();
    Object.assign(ids, {
      company: company.id, other: other.id, adm: adm.id, proc: proc.id, otherDept: otherDept.id, user: user.id,
      admNamed: admNamed.id, admOther: admOther.id, admRetired: admRetired.id, procOwn: procOwn.id, foreign: foreign.id,
      poType: poType.id, poTmpl: poTmpl.id, wf: wf.id,
      poFromAdm: poFromAdm.id, poWithOwn: poWithOwn.id, poWithRetired: poWithRetired.id, foreignDoc: foreignDoc.id,
    });

    const scope = new CompanyScopeService(orm.em);
    budgets = new BudgetService(orm.em, new AccountService(orm.em, scope), new BudgetBalanceService(orm.em), new ScopeService());
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('without a document, Procurement sees only its own money — the org tree adds nothing', async () => {
    const got = await asProc(() => budgets.listSelectable());
    expect(got.map((b) => b.id)).toEqual([ids.procOwn]);
  });

  it('offers back the ADM budget the PO carries, flagged inherited, beside its own', async () => {
    const got = await asProc(() => budgets.listSelectable(undefined, ids.poFromAdm));
    const byId = new Map(got.map((b) => [b.id, b]));
    expect(byId.get(ids.admNamed)).toMatchObject({ code: '1.101', inherited: true });
    expect(byId.get(ids.procOwn)).toBeDefined();
    expect(byId.get(ids.procOwn)!.inherited).toBeUndefined();
  });

  it('does not open the rest of ADM: a budget the PR never named stays out', async () => {
    const got = await asProc(() => budgets.listSelectable(undefined, ids.poFromAdm));
    expect(got.map((b) => b.id)).not.toContain(ids.admOther);
  });

  it('returns a budget the caller could select anyway once, unflagged', async () => {
    const got = await asProc(() => budgets.listSelectable(undefined, ids.poWithOwn));
    const own = got.filter((b) => b.id === ids.procOwn);
    expect(own).toHaveLength(1);
    expect(own[0].inherited).toBeUndefined();
  });

  it('leaves a retired inherited budget unavailable', async () => {
    const got = await asProc(() => budgets.listSelectable(undefined, ids.poWithRetired));
    expect(got.map((b) => b.id)).not.toContain(ids.admRetired);
  });

  it("adds nothing for another company's document", async () => {
    const plain = await asProc(() => budgets.listSelectable());
    const named = await asProc(() => budgets.listSelectable(undefined, ids.foreignDoc));
    expect(named).toEqual(plain);
    expect(named.map((b) => b.id)).not.toContain(ids.foreign);
  });

  it('carries no amount on an inherited row either', async () => {
    const got = await asProc(() => budgets.listSelectable(undefined, ids.poFromAdm));
    for (const row of got) expect(Object.keys(row)).not.toContain('amountTotal');
  });
});

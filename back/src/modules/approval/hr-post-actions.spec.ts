import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { Currency } from '../currency/currency.entities';
import { EmployeeService } from '../rbac/employee.service';
import { DocFieldValue, Document, DocumentType, FormField, FormTemplate } from '../document/document.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser, Employee, Role, UserCompanyRole } from '../rbac/rbac.entities';
import { Workflow } from './approval.entities';
import { PostActionService } from './post-action.service';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('HR post-actions: promotion + resignation (DB-backed)', () => {
  let orm: MikroORM;
  let employees: EmployeeService;
  let postAction: PostActionService;
  const ids = { coA: '', coB: '', deptA: '', deptB: '', roleA: '', roleB: '', creator: '', promoteType: '', resignType: '', promoteTmpl: '', resignTmpl: '', wf: '' };
  let seq = 0;

  const ref = <T>(cls: new (...a: any[]) => T, id: string) => orm.em.getReference(cls as any, id) as any;
  const reloadEmp = (id: string) => orm.em.fork().findOneOrFail(Employee, { id }, FILTER_OFF);

  /** A fresh employee in company A, optionally linked to a new user with memberships in A (+ B). */
  async function makeEmployee(opts: { withUser?: boolean; inBoth?: boolean } = {}): Promise<{ empId: string; userId?: string }> {
    const em = orm.em.fork();
    let user: AppUser | undefined;
    if (opts.withUser) {
      user = em.create(AppUser, { username: `u-${seq++}`, email: `u-${seq}@x`, status: 'ACTIVE' });
      em.create(UserCompanyRole, { user, company: ref(Company, ids.coA), department: ref(Department, ids.deptA), role: ref(Role, ids.roleA), isDefault: false });
      if (opts.inBoth) {
        em.create(UserCompanyRole, { user, company: ref(Company, ids.coB), department: ref(Department, ids.deptB), role: ref(Role, ids.roleB), isDefault: false });
      }
    }
    const emp = em.create(Employee, {
      company: ref(Company, ids.coA), department: ref(Department, ids.deptA), user,
      empCode: `E-${seq++}`, fullName: 'Worker', position: 'Clerk', jobLevel: 'STAFF', salary: '20000.00', status: 'ACTIVE',
    });
    await em.flush();
    return { empId: emp.id, userId: user?.id };
  }

  /** An approved HR document with the given field values. */
  async function hrDoc(typeId: string, tmplId: string, relatedEmployeeId: string | undefined, fields: Record<string, string>): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `H-${seq++}`, company: ref(Company, ids.coA), department: ref(Department, ids.deptA),
      documentType: ref(DocumentType, typeId), formTemplate: ref(FormTemplate, tmplId), workflow: ref(Workflow, ids.wf),
      createdBy: ref(AppUser, ids.creator), relatedEmployee: relatedEmployeeId ? ref(Employee, relatedEmployeeId) : undefined,
      exchangeRate: '1', status: DocStatus.APPROVED, createdAt: new Date(),
    });
    for (const [name, value] of Object.entries(fields)) {
      const ff = await em.findOneOrFail(FormField, { formTemplate: tmplId, fieldName: name }, FILTER_OFF);
      em.create(DocFieldValue, { document: doc, formField: ff, fieldValue: value });
    }
    await em.flush();
    return doc.id;
  }

  const runPostAction = async (docId: string) => {
    const doc = await orm.em.fork().findOneOrFail(Document, { id: docId }, FILTER_OFF);
    return orm.em.fork().transactional((tem: EntityManager) => postAction.run(doc, tem));
  };

  async function field(tmplId: string, name: string, sortOrder: number): Promise<void> {
    const em = orm.em.fork();
    em.create(FormField, { formTemplate: ref(FormTemplate, tmplId), fieldName: name, fieldLabel: name, fieldType: 'text', isRequired: false, sortOrder });
    await em.flush();
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    employees = new EmployeeService(orm.em);
    postAction = new PostActionService(new BudgetLedgerService(orm.em, new BudgetBalanceService(orm.em)), orm.em, undefined, employees);
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const coA = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const coB = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true });
    const deptA = em.create(Department, { company: coA, deptCode: 'DA', name: 'DA', isActive: true });
    const deptB = em.create(Department, { company: coB, deptCode: 'DB', name: 'DB', isActive: true });
    const roleA = em.create(Role, { company: coA, code: 'STAFF', name: 'Staff', isActive: true });
    const roleB = em.create(Role, { company: coB, code: 'STAFF', name: 'Staff', isActive: true });
    const creator = em.create(AppUser, { username: 'hr', email: 'hr@x', status: 'ACTIVE' });
    const promoteType = em.create(DocumentType, { code: 'PROMOTE', name: 'Promotion', category: DocCategory.HR, requiresBudget: false, requiresQuota: false, postAction: 'UPDATE_EMPLOYEE', isActive: true });
    const resignType = em.create(DocumentType, { code: 'RESIGN', name: 'Resignation', category: DocCategory.HR, requiresBudget: false, requiresQuota: false, postAction: 'TERMINATE_EMPLOYEE', isActive: true });
    const promoteTmpl = em.create(FormTemplate, { documentType: promoteType, version: 1, status: 'PUBLISHED' });
    const resignTmpl = em.create(FormTemplate, { documentType: resignType, version: 1, status: 'PUBLISHED' });
    const wf = em.create(Workflow, { company: coA, name: 'WF', isActive: true });
    await em.flush();
    Object.assign(ids, {
      coA: coA.id, coB: coB.id, deptA: deptA.id, deptB: deptB.id, roleA: roleA.id, roleB: roleB.id, creator: creator.id,
      promoteType: promoteType.id, resignType: resignType.id, promoteTmpl: promoteTmpl.id, resignTmpl: resignTmpl.id, wf: wf.id,
    });
    for (const [name, i] of [['new_position', 0], ['new_salary', 1], ['new_job_level', 2], ['effective_date', 3]] as const) {
      await field(promoteTmpl.id, name, i);
    }
    await field(resignTmpl.id, 'effective_date', 0);
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  // ---- Core (em-parameterized) ----------------------------------------------

  it('applyPromotion changes only the provided fields and preserves salary precision', async () => {
    const { empId } = await makeEmployee();
    await orm.em.fork().transactional((tem: EntityManager) =>
      employees.applyPromotion(empId, { position: 'Manager', salary: '30000.50' }, ids.coA, tem),
    );
    const e = await reloadEmp(empId);
    expect(e.position).toBe('Manager');
    expect(e.salary).toBe('30000.50');
    expect(e.jobLevel).toBe('STAFF'); // not provided → unchanged
  });

  it('applyResignation expires only the active company roles as of the effective date', async () => {
    const { empId, userId } = await makeEmployee({ withUser: true, inBoth: true });
    await orm.em.fork().transactional((tem: EntityManager) =>
      employees.applyResignation(empId, '2026-12-31', ids.coA, tem),
    );
    expect((await reloadEmp(empId)).status).toBe('RESIGNED');
    const roles = await orm.em.fork().find(UserCompanyRole, { user: userId }, FILTER_OFF);
    const a = roles.find((r) => r.company.id === ids.coA)!;
    const b = roles.find((r) => r.company.id === ids.coB)!;
    expect(a.validTo).toBe('2026-12-31');
    expect(b.validTo).toBeNull(); // company B untouched
  });

  // ---- Post-action flow ------------------------------------------------------

  it('UPDATE_EMPLOYEE post-action promotes the related employee on approval', async () => {
    const { empId } = await makeEmployee();
    const docId = await hrDoc(ids.promoteType, ids.promoteTmpl, empId, {
      new_position: 'Director', new_salary: '55000.00', new_job_level: 'MANAGER', effective_date: '2026-07-01',
    });
    await runPostAction(docId);
    const e = await reloadEmp(empId);
    expect(e.position).toBe('Director');
    expect(e.salary).toBe('55000.00');
    expect(e.jobLevel).toBe('MANAGER');
  });

  it('TERMINATE_EMPLOYEE post-action closes the employee and expires company roles', async () => {
    const { empId, userId } = await makeEmployee({ withUser: true, inBoth: true });
    const docId = await hrDoc(ids.resignType, ids.resignTmpl, empId, { effective_date: '2026-09-30' });
    await runPostAction(docId);
    expect((await reloadEmp(empId)).status).toBe('RESIGNED');
    const roles = await orm.em.fork().find(UserCompanyRole, { user: userId }, FILTER_OFF);
    expect(roles.find((r) => r.company.id === ids.coA)!.validTo).toBe('2026-09-30');
    expect(roles.find((r) => r.company.id === ids.coB)!.validTo).toBeNull();
  });

  it('HR post-action with no related employee is a no-op', async () => {
    const docId = await hrDoc(ids.promoteType, ids.promoteTmpl, undefined, { new_position: 'X' });
    await expect(runPostAction(docId)).resolves.not.toThrow();
  });

  it('a non-decimal salary fails the post-action (rolls back, employee unchanged)', async () => {
    const { empId } = await makeEmployee();
    const docId = await hrDoc(ids.promoteType, ids.promoteTmpl, empId, { new_position: 'Director', new_salary: 'oops' });
    await expect(runPostAction(docId)).rejects.toThrow(/salary/i);
    const e = await reloadEmp(empId);
    expect(e.position).toBe('Clerk'); // unchanged — transaction rolled back
    expect(e.salary).toBe('20000.00');
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[hr-post-actions] no database reachable — skipping DB-backed spec');
}

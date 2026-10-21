import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { ApproverResolverService, type EligibilityQuestion, type StepTarget } from './approver-resolver.service';
import { ApprovalDelegation, Workflow } from './approval.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Currency } from '../currency/currency.entities';
import { DocCategory, DocStatus } from '../../common/enums';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { AppUser, Role, UserCompanyRole } from '../rbac/rbac.entities';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The inbox asks who may act on every pending document in the company at once. It used to ask one
 * document at a time — a company read, a role read and a delegation read per approver, per
 * document — and an inbox open cost some 1,500 queries on production, which every approval then
 * waited on. `eligibleMany` answers the whole set in a fixed number of reads.
 *
 * Who may approve is invariant 8, so the batch must answer EXACTLY what one-at-a-time answers, for
 * every rule: a role's validity window, a delegation's window, its amount limit and document type,
 * escalation, and the creator never being an actor. And it must stay a fixed number of reads.
 */
describe.skipIf(!hasDb)('eligibility in a batch (DB-backed)', () => {
  let orm: MikroORM;
  const u: Record<string, string> = {};
  let questions: EligibilityQuestion[] = [];
  let expected: string[][] = [];

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const lak = em.create(Currency, { code: 'LAK', name: 'Kip', decimalPlaces: 0, isActive: true });
    const coA = em.create(Company, { code: 'BA', nameTh: 'BA', taxId: '1', branchCode: '00000', baseCurrency: lak, timezone: 'Asia/Bangkok', isActive: true });
    const coB = em.create(Company, { code: 'BB', nameTh: 'BB', taxId: '2', branchCode: '00000', baseCurrency: lak, timezone: 'Asia/Bangkok', isActive: true });
    const deptA = em.create(Department, { company: coA, deptCode: 'D', name: 'D', isActive: true });
    const deptB = em.create(Department, { company: coB, deptCode: 'D', name: 'D', isActive: true });
    const user = (name: string) => em.create(AppUser, { username: `b-${name}`, email: `${name}@x`, status: 'ACTIVE' });
    const [holder, expired, future, named, delegate, generic, escalated, creator, holderB] =
      ['holder', 'expired', 'future', 'named', 'delegate', 'generic', 'escalated', 'creator', 'holderB'].map(user);
    const role = em.create(Role, { company: coA, code: 'APPR', name: 'Approver', isActive: true });
    const roleB = em.create(Role, { company: coB, code: 'APPR', name: 'Approver', isActive: true });
    em.create(UserCompanyRole, { user: holder, company: coA, department: deptA, role, isDefault: false });
    // Assignments outside today's window are not holders today.
    em.create(UserCompanyRole, { user: expired, company: coA, department: deptA, role, isDefault: false, validTo: '2000-01-01' });
    em.create(UserCompanyRole, { user: future, company: coA, department: deptA, role, isDefault: false, validFrom: '2999-01-01' });
    em.create(UserCompanyRole, { user: holderB, company: coB, department: deptB, role: roleB, isDefault: false });

    const type = (code: string, company: Company) => em.create(DocumentType, {
      company, code, name: code, category: DocCategory.ADMIN, requiresBudget: false, requiresQuota: false, isActive: true,
    });
    const memo = type('MEMO', coA);
    const other = type('OTHER', coA);
    const memoB = type('MEMO', coB);
    // The holder's cover: memos only, up to 100.
    em.create(ApprovalDelegation, {
      company: coA, delegator: holder, delegate, documentType: memo, amountLimit: '100',
      startDate: '2000-01-01', endDate: '2999-12-31', status: 'ACTIVE', createdAt: new Date(),
    });
    // The named approver's cover: any type, no limit — in company A only.
    em.create(ApprovalDelegation, {
      company: coA, delegator: named, delegate: generic,
      startDate: '2000-01-01', endDate: '2999-12-31', status: 'ACTIVE', createdAt: new Date(),
    });
    // A lapsed delegation is no delegation.
    em.create(ApprovalDelegation, {
      company: coA, delegator: holder, delegate: generic, documentType: other,
      startDate: '2000-01-01', endDate: '2000-12-31', status: 'ACTIVE', createdAt: new Date(),
    });

    const wf = em.create(Workflow, { company: coA, name: 'WF', isActive: true });
    const wfB = em.create(Workflow, { company: coB, name: 'WF', isActive: true });
    let seq = 0;
    const doc = (dt: DocumentType, amount: string, createdBy = creator, company = coA, dept = deptA, workflow = wf) => {
      const tmpl = em.create(FormTemplate, { documentType: dt, version: ++seq, status: 'PUBLISHED' });
      return em.create(Document, {
        docNo: `B-${seq}`, company, department: dept, documentType: dt, formTemplate: tmpl, workflow,
        currentStepNo: 1, createdBy, exchangeRate: '1', baseTotalAmount: amount,
        status: DocStatus.IN_APPROVAL, submittedAt: new Date(), createdAt: new Date(),
      });
    };
    const byRole: StepTarget = { approverRole: role };
    const cases: Array<[StepTarget, Document, AppUser[]]> = [
      [byRole, doc(memo, '50'), [holder, delegate]],
      [byRole, doc(memo, '500'), [holder]], // over the delegation's limit
      [byRole, doc(other, '50'), [holder]], // the delegation covers memos only; the OTHER one lapsed
      [{ approverUser: named }, doc(other, '9999'), [named, generic]],
      [{ approverRole: role, escalatedToUser: escalated }, doc(memo, '50'), [holder, delegate, escalated]],
      // Escalated to the creator: never an actor on their own document.
      [{ approverRole: role, escalatedToUser: escalated }, doc(memo, '50', escalated), [holder, delegate]],
      // Company B: B's holder only, and A's delegation from `named` does not reach B's document.
      [{ approverRole: roleB }, doc(memoB, '50', creator, coB, deptB, wfB), [holderB]],
      [{ approverUser: named }, doc(memoB, '50', creator, coB, deptB, wfB), [named]],
      [{}, doc(memo, '50'), []],
    ];
    await em.flush();
    questions = cases.map(([step, document]) => ({ step, document }));
    expected = cases.map(([, , who]) => who.map((w) => w.id).sort());
    Object.assign(u, { holder: holder.id });
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  const ids = (actors: Array<{ userId: string }>) => actors.map((a) => a.userId).sort();

  function counting(em: EntityManager) {
    const conn = em.getConnection() as unknown as { execute: (...a: unknown[]) => Promise<unknown> };
    const original = conn.execute.bind(conn);
    const box = { queries: 0, restore: () => { conn.execute = original; } };
    conn.execute = (...args: unknown[]) => { box.queries += 1; return original(...args); };
    return box;
  }

  it('answers each rule as expected', async () => {
    const got = await new ApproverResolverService(orm.em.fork()).eligibleMany(questions);
    expect(got.map(ids)).toEqual(expected);
  });

  it('answers exactly what asking one document at a time answers', async () => {
    const svc = new ApproverResolverService(orm.em.fork());
    const batch = await svc.eligibleMany(questions);
    const single = [];
    for (const q of questions) single.push(await svc.eligible(q.step, q.document));
    expect(batch).toEqual(single);
  });

  it('marks who a delegate acts for', async () => {
    const [first] = await new ApproverResolverService(orm.em.fork()).eligibleMany(questions.slice(0, 1));
    expect(first.find((a) => a.delegatedFrom)?.delegatedFrom).toBe(u.holder);
  });

  it('reads a fixed number of times, however many documents are asked about', async () => {
    const em = orm.em.fork();
    const svc = new ApproverResolverService(em);
    const many = Array.from({ length: 20 }, () => questions).flat();
    const box = counting(em);
    try {
      await svc.eligibleMany(many);
    } finally {
      box.restore();
    }
    // The companies' days, the role holders, the delegations.
    expect(box.queries).toBeLessThanOrEqual(3);
  });

  it('answers nothing for nothing, without reading', async () => {
    const em = orm.em.fork();
    const box = counting(em);
    try {
      expect(await new ApproverResolverService(em).eligibleMany([])).toEqual([]);
    } finally {
      box.restore();
    }
    expect(box.queries).toBe(0);
  });
});

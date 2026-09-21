import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MikroORM } from '@mikro-orm/postgresql';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { isExplained } from '../../common/errors/error-code';
import { ApproveAction, DocCategory, DocStatus, IntakeAction, Scope } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { materialiseRoute } from '../../test/route-fixture';
import { Currency } from '../currency/currency.entities';
import { ApprovalLog, DocumentApprovalStep, Workflow, WorkflowStep } from '../approval/approval.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser, Employee, Role, UserCompanyRole } from '../rbac/rbac.entities';
import { Document, DocumentIntakeLog, DocumentType, FormTemplate } from './document.entities';
import { DocumentIntakeService, INTAKE_REFUSAL } from './document-intake.service';
import { DocumentService } from './document.service';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Finance's intake book.
 *
 * The rule under test is a ROUTING fact: a document has reached a user when its live route has
 * OPENED a step recording them as a principal. These pin that it reads neither the status, nor
 * `current_step_no`, nor — the one that matters most — a role name. The live data routes every
 * workflow to a role called FINANCE; the step below is deliberately called something else, so a
 * test that passes only because of that name cannot pass here.
 */
describe.skipIf(!hasDb)('document intake (DB-backed)', () => {
  let orm: MikroORM;
  let svc: DocumentIntakeService;
  let documents: DocumentService;
  let seq = 0;

  const ids = {
    companyA: '', companyB: '',
    deptA: '', deptB: '',
    /** Targets a role, so it records EVERY holder when it opens. Named nothing like "finance". */
    roleDesk: '',
    dtA: '', tmplA: '', wfA: '',
    dtB: '', tmplB: '', wfB: '',
    /** Two holders of roleDesk — the step is one desk with two people at it. */
    clerkOne: '', clerkTwo: '',
    /** Holds no role the route names. */
    outsider: '',
    /** Raises the documents. */
    author: '',
  };

  // `DOC_INTAKE_RECEIVE` is in the grants because `list()` resolves the per-row `canReceive`
  // verdict only for a reader who could act on it — two extra queries nobody else should pay for.
  const as = <T>(fn: () => Promise<T>, userId: string, companyId = ids.companyA) =>
    RequestContext.run(
      {
        userId,
        companyId,
        departmentId: ids.deptA,
        grants: [
          { code: 'DOC_VIEW', scope: Scope.COMPANY },
          { code: 'DOC_INTAKE_RECEIVE', scope: Scope.COMPANY },
        ],
      },
      fn,
    );

  /** The same reader WITHOUT the intake code — for asserting the verdict is not computed. */
  const asPlainReader = <T>(fn: () => Promise<T>, userId: string) =>
    RequestContext.run(
      { userId, companyId: ids.companyA, departmentId: ids.deptA, grants: [{ code: 'DOC_VIEW', scope: Scope.COMPANY }] },
      fn,
    );

  /**
   * A document sitting on `openStepNo` of a three-step route.
   *
   * Step 2 is the role-targeted desk. Opening step 1 leaves step 2 with no actor rows at all,
   * which is the whole point of the "not yet reached" case — `openStep` writes them, nothing else.
   */
  async function doc(opts: { openStepNo?: number; status?: DocStatus; company?: 'A' | 'B' } = {}): Promise<string> {
    const inB = opts.company === 'B';
    const em = orm.em.fork();
    const d = em.create(Document, {
      docNo: `IN-${seq++}`,
      company: em.getReference(Company, inB ? ids.companyB : ids.companyA),
      department: em.getReference(Department, inB ? ids.deptB : ids.deptA),
      documentType: em.getReference(DocumentType, inB ? ids.dtB : ids.dtA),
      formTemplate: em.getReference(FormTemplate, inB ? ids.tmplB : ids.tmplA),
      workflow: em.getReference(Workflow, inB ? ids.wfB : ids.wfA),
      createdBy: em.getReference(AppUser, ids.author),
      exchangeRate: '1',
      totalAmount: '10',
      baseTotalAmount: '10',
      status: opts.status ?? DocStatus.IN_APPROVAL,
      currentStepNo: opts.openStepNo ?? 1,
      submittedAt: new Date(),
      createdAt: new Date(),
    } as never);
    await em.flush();
    if (opts.openStepNo) await materialiseRoute(orm, d.id, opts.openStepNo);
    return d.id;
  }

  const logRows = async (documentId: string) => {
    const em = orm.em.fork();
    const rows = await em.find(DocumentIntakeLog, { document: documentId }, { populate: ['actor'], ...FILTER_OFF });
    // Sorted here, not in the query: an identical find on the same fork can come back with its
    // ORDER BY dropped, and these assertions are about which row is last.
    return rows.sort((a, b) => a.actedAt.getTime() - b.actedAt.getTime());
  };

  const stateOf = async (documentId: string, userId = ids.clerkOne) =>
    (await as(() => svc.stateFor([documentId]), userId)).get(documentId)!;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();

    const cur = em.create(Currency, { code: 'LAK', name: 'Kip', decimalPlaces: 0, isActive: true });
    const a = em.create(Company, { code: 'IA', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: cur, isActive: true });
    const b = em.create(Company, { code: 'IB', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: cur, isActive: true });
    const deptA = em.create(Department, { company: a, deptCode: 'D1', name: 'Somewhere', isActive: true });
    const deptB = em.create(Department, { company: b, deptCode: 'D2', name: 'Elsewhere', isActive: true });

    // Deliberately NOT called finance, and its code is not FINANCE. If the rule ever starts
    // reading a role name, this fixture stops matching and these tests go red.
    const roleDesk = em.create(Role, { company: a, code: 'ZZ_DESK', name: 'Second Desk', isActive: true });
    const roleOther = em.create(Role, { company: a, code: 'ZZ_OTHER', name: 'Other', isActive: true });

    const mk = (n: string) => em.create(AppUser, { username: n, email: `${n}@x`, status: 'ACTIVE' });
    const clerkOne = mk('i-clerk-1');
    const clerkTwo = mk('i-clerk-2');
    const outsider = mk('i-outsider');
    const author = mk('i-author');
    // Both clerks hold the desk role; the outsider and the author do not.
    for (const u of [clerkOne, clerkTwo]) {
      em.create(UserCompanyRole, { user: u, company: a, department: deptA, role: roleDesk, isDefault: true });
    }
    for (const u of [outsider, author]) {
      em.create(UserCompanyRole, { user: u, company: a, department: deptA, role: roleOther, isDefault: true });
    }
    em.create(Employee, {
      company: a, department: deptA, user: clerkOne, empCode: 'I-1', fullName: 'Bounmy Keo', status: 'ACTIVE',
    } as never);

    const dtA = em.create(DocumentType, {
      company: a, code: 'IMEMO', name: 'Memo', category: DocCategory.ADMIN,
      requiresBudget: false, requiresQuota: false, isActive: true,
    });
    const tmplA = em.create(FormTemplate, { documentType: dtA, version: 1, status: 'PUBLISHED' });
    const wfA = em.create(Workflow, { company: a, name: 'I-WF', isActive: true });
    // 1: a named user. 2: the role-targeted desk. 3: another named user, after it.
    em.create(WorkflowStep, { workflow: wfA, stepNo: 1, approverUser: author, approveMode: 'SEQUENTIAL' });
    em.create(WorkflowStep, { workflow: wfA, stepNo: 2, approverRole: roleDesk, approveMode: 'SEQUENTIAL' });
    em.create(WorkflowStep, { workflow: wfA, stepNo: 3, approverUser: outsider, approveMode: 'SEQUENTIAL' });

    const dtB = em.create(DocumentType, {
      company: b, code: 'IMEMO', name: 'Memo', category: DocCategory.ADMIN,
      requiresBudget: false, requiresQuota: false, isActive: true,
    });
    const tmplB = em.create(FormTemplate, { documentType: dtB, version: 1, status: 'PUBLISHED' });
    const wfB = em.create(Workflow, { company: b, name: 'I-WF-B', isActive: true });
    em.create(WorkflowStep, { workflow: wfB, stepNo: 1, approverUser: clerkOne, approveMode: 'SEQUENTIAL' });

    await em.flush();
    Object.assign(ids, {
      companyA: a.id, companyB: b.id, deptA: deptA.id, deptB: deptB.id, roleDesk: roleDesk.id,
      dtA: dtA.id, tmplA: tmplA.id, wfA: wfA.id,
      dtB: dtB.id, tmplB: tmplB.id, wfB: wfB.id,
      clerkOne: clerkOne.id, clerkTwo: clerkTwo.id, outsider: outsider.id, author: author.id,
    });

    svc = new DocumentIntakeService(orm.em, new CompanyScopeService(orm.em));
    documents = new DocumentService(
      orm.em,
      new CompanyScopeService(orm.em),
      null as never, null as never, null as never, null as never, null as never,
    );
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  describe('what "reached me" means', () => {
    it('a document whose route opened a step naming the reader has reached them', async () => {
      const id = await doc({ openStepNo: 2 });
      expect(await as(() => svc.hasReached(id, ids.clerkOne), ids.clerkOne)).toBe(true);
    });

    it('a later step that names the reader but has not opened has not reached them', async () => {
      // Step 2 is the reader's, and this document sits on step 1. `openStep` writes the actor
      // rows, so step 2 has none — which is exactly the fact being read.
      const id = await doc({ openStepNo: 1 });
      expect(await as(() => svc.hasReached(id, ids.clerkOne), ids.clerkOne)).toBe(false);
    });

    it('a draft has reached nobody', async () => {
      const id = await doc({ status: DocStatus.DRAFT }); // no route materialised at all
      expect(await as(() => svc.hasReached(id, ids.clerkOne), ids.clerkOne)).toBe(false);
    });

    it('a document still in approval has reached the desk it is sitting on', async () => {
      const id = await doc({ openStepNo: 2, status: DocStatus.IN_APPROVAL });
      expect(await as(() => svc.hasReached(id, ids.clerkOne), ids.clerkOne)).toBe(true);
    });

    it('every holder of a role-targeted step is reached, not just one', async () => {
      const id = await doc({ openStepNo: 2 });
      expect(await as(() => svc.hasReached(id, ids.clerkOne), ids.clerkOne)).toBe(true);
      expect(await as(() => svc.hasReached(id, ids.clerkTwo), ids.clerkTwo)).toBe(true);
      // The outsider holds a different role and is named by no opened step.
      expect(await as(() => svc.hasReached(id, ids.outsider), ids.outsider)).toBe(false);
    });

    /**
     * The case a finance officer actually hits: they signed their step days ago, the document has
     * moved on (or finished), and only now do they notice they never registered the paper.
     */
    it('still counts after the reader approved their step and the route moved on', async () => {
      const id = await doc({ openStepNo: 2 });
      const em = orm.em.fork();
      const step2 = await em.findOneOrFail(DocumentApprovalStep, { document: id, stepNo: 2 }, FILTER_OFF);
      // What `closeStep` does: the step is done. It does NOT supersede the row or drop its actors.
      step2.completedAt = new Date();
      step2.status = 'DONE';
      const document = await em.findOneOrFail(Document, { id }, FILTER_OFF);
      document.currentStepNo = 3;
      await em.flush();

      expect(await as(() => svc.hasReached(id, ids.clerkOne), ids.clerkOne)).toBe(true);
      const [outcome] = await as(() => svc.receive([id]), ids.clerkOne);
      expect(outcome.received).toBe(true);
    });

    it('still counts once the document is finished', async () => {
      const id = await doc({ openStepNo: 2 });
      const em = orm.em.fork();
      const document = await em.findOneOrFail(Document, { id }, FILTER_OFF);
      document.status = DocStatus.COMPLETED;
      document.approvedAt = new Date();
      await em.flush();

      const [outcome] = await as(() => svc.receive([id]), ids.clerkOne);
      expect(outcome.received).toBe(true);
    });

    /**
     * A return-and-resubmit supersedes the whole previous route, actor rows and all. Without the
     * append-only trail, an officer who signed the first attempt would silently lose the ability
     * to register paper that is sitting on their desk right now.
     */
    it('still counts when a resubmission superseded the route the reader acted on', async () => {
      const id = await doc({ openStepNo: 2 });
      const em = orm.em.fork();
      // They acted — that row is append-only and outlives any re-routing.
      em.create(ApprovalLog, {
        document: em.getReference(Document, id),
        stepNo: 2,
        approver: em.getReference(AppUser, ids.clerkOne),
        action: ApproveAction.APPROVE,
        actedAt: new Date(),
      } as never);
      // Then the document was returned and resubmitted: `materialise` supersedes every live row.
      const live = await em.find(DocumentApprovalStep, { document: id, supersededAt: null }, FILTER_OFF);
      for (const row of live) row.supersededAt = new Date();
      await em.flush();

      expect(await as(() => svc.hasReached(id, ids.clerkOne), ids.clerkOne)).toBe(true);
      const [outcome] = await as(() => svc.receive([id]), ids.clerkOne);
      expect(outcome.received).toBe(true);
    });

    it('does not count a requester withdrawing their own document', async () => {
      // CANCEL is the requester pulling their own request, not a reviewer the route delivered it
      // to. Counting it would let anyone who withdrew a document register it as having arrived.
      const id = await doc({ openStepNo: 1 }); // step 1 names the author, not the clerks
      const em = orm.em.fork();
      em.create(ApprovalLog, {
        document: em.getReference(Document, id),
        stepNo: 1,
        approver: em.getReference(AppUser, ids.outsider),
        action: ApproveAction.CANCEL,
        actedAt: new Date(),
      } as never);
      await em.flush();

      expect(await as(() => svc.hasReached(id, ids.outsider), ids.outsider)).toBe(false);
    });

    it('a superseded route step alone, with no action recorded, does not count as arrival', async () => {
      const id = await doc({ openStepNo: 2 });
      const em = orm.em.fork();
      const step = await em.findOneOrFail(DocumentApprovalStep, { document: id, stepNo: 2 }, FILTER_OFF);
      step.supersededAt = new Date();
      await em.flush();
      expect(await as(() => svc.hasReached(id, ids.clerkOne), ids.clerkOne)).toBe(false);
    });

    it('the rule names no role and no department anywhere in its source', async () => {
      // Invariants 5 and 7, asserted rather than trusted: a company whose desk step is called
      // something else must get the same answer, and this fixture's role IS called something
      // else. The source check catches the shortcut that would make that accidental.
      const src = await import('node:fs/promises').then((fs) =>
        fs.readFile(new URL('./document-intake.service.ts', import.meta.url), 'utf8'),
      );
      const code = src.split('*/').slice(1).join('*/'); // strip the leading doc comment
      expect(code).not.toMatch(/'FINANCE'|"FINANCE"|'FN'|"FN"/);
      expect(code).not.toMatch(/roleCode|deptCode/);
    });
  });

  describe('receiving', () => {
    it('writes one RECEIVE row and the document then reads as received', async () => {
      const id = await doc({ openStepNo: 2 });
      const [outcome] = await as(() => svc.receive([id]), ids.clerkOne);
      expect(outcome).toEqual({ documentId: id, received: true, refusal: null });

      const rows = await logRows(id);
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe(IntakeAction.RECEIVE);
      expect(rows[0].actor.id).toBe(ids.clerkOne);

      const state = await stateOf(id);
      expect(state.received).toBe(true);
      // The employee full name, not the username — the same rule the rest of the app names by.
      expect(state.receivedByName).toBe('Bounmy Keo');
      expect(state.receivedAt).toBeInstanceOf(Date);
    });

    it('refuses a document that has not reached the reader, writing nothing', async () => {
      const id = await doc({ openStepNo: 1 });
      const [outcome] = await as(() => svc.receive([id]), ids.clerkOne);
      expect(outcome.refusal).toBe(INTAKE_REFUSAL.NOT_REACHED);
      expect(await logRows(id)).toHaveLength(0);
    });

    it('refuses a second receipt rather than repeating it', async () => {
      const id = await doc({ openStepNo: 2 });
      await as(() => svc.receive([id]), ids.clerkOne);
      const [again] = await as(() => svc.receive([id]), ids.clerkTwo);
      expect(again.refusal).toBe(INTAKE_REFUSAL.ALREADY_RECEIVED);
      expect(await logRows(id)).toHaveLength(1);
    });

    it('registers the rest of a batch when one document is already taken', async () => {
      const taken = await doc({ openStepNo: 2 });
      await as(() => svc.receive([taken]), ids.clerkTwo);
      const fresh = await Promise.all([doc({ openStepNo: 2 }), doc({ openStepNo: 2 })]);

      const outcomes = await as(() => svc.receive([fresh[0], taken, fresh[1]]), ids.clerkOne);
      expect(outcomes.filter((o) => o.received).map((o) => o.documentId).sort()).toEqual([...fresh].sort());
      expect(outcomes.find((o) => o.documentId === taken)!.refusal).toBe(INTAKE_REFUSAL.ALREADY_RECEIVED);
    });

    it('reports a document from another company as not found and writes nothing', async () => {
      const other = await doc({ openStepNo: 1, company: 'B' });
      const [outcome] = await as(() => svc.receive([other]), ids.clerkOne);
      expect(outcome.refusal).toBe(INTAKE_REFUSAL.NOT_FOUND);
      expect(await logRows(other)).toHaveLength(0);
    });
  });

  describe('reversing', () => {
    it('appends a REVERSE row and leaves the receipt it undoes untouched', async () => {
      const id = await doc({ openStepNo: 2 });
      await as(() => svc.receive([id]), ids.clerkOne);
      const receiptId = (await logRows(id))[0].id;

      await as(() => svc.reverse(id, 'wrong pile'), ids.clerkTwo);

      const rows = await logRows(id);
      expect(rows.map((r) => r.action)).toEqual([IntakeAction.RECEIVE, IntakeAction.REVERSE]);
      // The receipt is still there, still naming who took the paper in (invariant 2).
      expect(rows[0].id).toBe(receiptId);
      expect(rows[0].actor.id).toBe(ids.clerkOne);
      expect(rows[1].note).toBe('wrong pile');
      expect((await stateOf(id)).received).toBe(false);
    });

    it('can receive again after a reversal', async () => {
      const id = await doc({ openStepNo: 2 });
      await as(() => svc.receive([id]), ids.clerkOne);
      await as(() => svc.reverse(id), ids.clerkTwo);
      const [again] = await as(() => svc.receive([id]), ids.clerkOne);

      expect(again.received).toBe(true);
      expect((await logRows(id)).map((r) => r.action)).toEqual([
        IntakeAction.RECEIVE, IntakeAction.REVERSE, IntakeAction.RECEIVE,
      ]);
      expect((await stateOf(id)).received).toBe(true);
    });

    it('refuses to reverse a document that is not currently received', async () => {
      const id = await doc({ openStepNo: 2 });
      // The refusal carries the key the web app translates, not just an English sentence.
      const err = await as(() => svc.reverse(id), ids.clerkTwo).catch((e: unknown) => e);
      expect(isExplained(err)).toBe(true);
      expect((err as { messageKey: string }).messageKey).toBe('intake.notReceived');
      expect(await logRows(id)).toHaveLength(0);
    });
  });

  describe('derived state for a page', () => {
    it('reads never-received, received and reversed without a query per row', async () => {
      const never = await doc({ openStepNo: 2 });
      const received = await doc({ openStepNo: 2 });
      const reversed = await doc({ openStepNo: 2 });
      await as(() => svc.receive([received, reversed]), ids.clerkOne);
      await as(() => svc.reverse(reversed), ids.clerkTwo);

      const em = orm.em.fork();
      let queries = 0;
      const conn = em.getConnection() as unknown as { execute: (...a: unknown[]) => Promise<unknown> };
      const original = conn.execute.bind(conn);
      conn.execute = (...args: unknown[]) => { queries += 1; return original(...args); };
      let state: Map<string, { received: boolean; receivedByName: string | null }>;
      try {
        state = await as(() => svc.stateFor([never, received, reversed], em), ids.clerkOne);
      } finally {
        conn.execute = original;
      }

      expect(state.get(never)).toEqual({ received: false, receivedByName: null, receivedAt: null, canReceive: false });
      expect(state.get(received)!.received).toBe(true);
      expect(state.get(received)!.receivedByName).toBe('Bounmy Keo');
      expect(state.get(reversed)!.received).toBe(false);
      // The log read, the user read and the employee read. Three documents, nowhere near one each.
      expect(queries).toBeLessThanOrEqual(4);
    });
  });

  describe('concurrency', () => {
    it('two officers receiving at the same moment leave exactly one receipt', async () => {
      const id = await doc({ openStepNo: 2 });

      const [one, two] = await Promise.all([
        as(() => svc.receive([id]), ids.clerkOne),
        as(() => svc.receive([id]), ids.clerkTwo),
      ]);

      const outcomes = [one[0], two[0]];
      expect(outcomes.filter((o) => o.received)).toHaveLength(1);
      expect(outcomes.filter((o) => o.refusal === INTAKE_REFUSAL.ALREADY_RECEIVED)).toHaveLength(1);
      expect(await logRows(id)).toHaveLength(1);
    });
  });

  describe('the list carries the state', () => {
    type Row = { id: string; intake: { received: boolean; receivedByName: string | null; canReceive: boolean } };
    const listRows = async () =>
      (await as(() => documents.list({ limit: 50 } as never), ids.clerkOne)).items as unknown as Row[];

    it('says received, reversed and never-received apart on the rows themselves', async () => {
      const never = await doc({ openStepNo: 2 });
      const received = await doc({ openStepNo: 2 });
      const reversed = await doc({ openStepNo: 2 });
      await as(() => svc.receive([received, reversed]), ids.clerkOne);
      await as(() => svc.reverse(reversed), ids.clerkTwo);

      const rows = await listRows();
      const rowFor = (id: string) => rows.find((r) => r.id === id)!;

      expect(rowFor(received).intake.received).toBe(true);
      expect(rowFor(received).intake.receivedByName).toBe('Bounmy Keo');
      expect(rowFor(reversed).intake.received).toBe(false);
      expect(rowFor(reversed).intake.receivedByName).toBeNull();
      expect(rowFor(never).intake).toEqual({ received: false, receivedByName: null, receivedAt: null, canReceive: true });
    });

    /**
     * The verdict the screen draws its button from. Without it the list offered a receive action
     * on every unreceived row and the server refused most of them — a button that is always
     * refused is worse than no button.
     */
    it('says per row whether THIS reader may receive it', async () => {
      const reached = await doc({ openStepNo: 2 }); // opened the desk step naming both clerks
      const notReached = await doc({ openStepNo: 1 }); // still on step 1, which names the author
      const already = await doc({ openStepNo: 2 });
      await as(() => svc.receive([already]), ids.clerkTwo);

      const rows = await listRows();
      const rowFor = (id: string) => rows.find((r) => r.id === id)!;

      expect(rowFor(reached).intake.canReceive).toBe(true);
      // Reached nobody at this desk yet: the button must not be drawn.
      expect(rowFor(notReached).intake.canReceive).toBe(false);
      // Already taken: the server refuses a second receipt, so the screen must not offer one.
      expect(rowFor(already).intake.canReceive).toBe(false);
      expect(rowFor(already).intake.received).toBe(true);
    });

    it('answers canReceive for the reader asking, not for whoever asked last', async () => {
      // Step 3 names the outsider alone. The clerks must not inherit their verdict.
      const id = await doc({ openStepNo: 3 });
      const forOutsider = await as(() => documents.list({ limit: 50 } as never), ids.outsider);
      const forClerk = await as(() => documents.list({ limit: 50 } as never), ids.clerkOne);
      const find = (page: { items: unknown[] }) =>
        (page.items as Array<{ id: string; intake: { canReceive: boolean } }>).find((r) => r.id === id)!;

      expect(find(forOutsider).intake.canReceive).toBe(true);
      expect(find(forClerk).intake.canReceive).toBe(false);
    });

    it('does not compute the verdict for a reader who cannot receive anything', async () => {
      const id = await doc({ openStepNo: 2 });
      const page = await asPlainReader(() => documents.list({ limit: 50 } as never), ids.clerkOne);
      const row = (page.items as Array<{ id: string; intake: { canReceive: boolean } }>).find((r) => r.id === id)!;
      // The same document the same person CAN receive — they simply are not being asked here.
      expect(row.intake.canReceive).toBe(false);
    });

    it('resolves a page of mixed states in a bounded number of queries', async () => {
      const made: string[] = [];
      for (let i = 0; i < 10; i++) made.push(await doc({ openStepNo: 2 }));
      // Half received, so the receiver-name reads are exercised rather than skipped.
      await as(() => svc.receive(made.slice(0, 5)), ids.clerkOne);

      const em = orm.em.fork();
      let queries = 0;
      const conn = em.getConnection() as unknown as { execute: (...a: unknown[]) => Promise<unknown> };
      const original = conn.execute.bind(conn);
      conn.execute = (...args: unknown[]) => { queries += 1; return original(...args); };
      try {
        await as(() => documents.list({ limit: 50 } as never), ids.clerkOne);
      } finally {
        conn.execute = original;
      }
      // The page, its count, the visibility reads, the requester reads and the intake reads.
      // A handful — and nowhere near one per row.
      expect(queries).toBeLessThanOrEqual(12);
    });
  });
});

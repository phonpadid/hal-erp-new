import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocCategory, DocStatus, PendingSuccessorStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { BudgetService } from '../budget/budget.service';
import { BudgetTxn } from '../budget/budget.entities';
import { AccountService } from '../accounting/account.service';
import { Currency } from '../currency/currency.entities';
import { DeptDocTypeService } from '../document/dept-doc-type.service';
import { DocumentService } from '../document/document.service';
import { NumberingService } from '../document/numbering.service';
import {
  DeptDocType,
  Document,
  DocumentType,
  DocumentTypeRef,
  FormTemplate,
} from '../document/document.entities';
import { ItemService } from '../master-data/item.service';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { PendingSuccessor, Workflow } from './approval.entities';
import { PostActionService } from './post-action.service';
import { MAX_ATTEMPTS, SuccessorSweeper } from './successor-sweeper.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The CREATE_SUCCESSOR outbox: the obligation is recorded inside the approval transaction, and a
 * sweeper fulfils it afterwards.
 *
 * The fixture deliberately puts the REQUESTER and the APPROVER in different departments — the case
 * the pre-existing fixtures cannot see, because they run everything in one department, and the
 * whole reason the successor's identity is configured rather than inherited.
 */
describe.skipIf(!hasDb)('successor outbox (DB-backed)', () => {
  let orm: MikroORM;

  const ids = {
    company: '', deptIt: '', deptProc: '', otherCompany: '', otherDept: '',
    requester: '', approver: '',
    procType: '', poType: '', inactiveType: '',
    procTmpl: '', poTmpl: '', wf: '',
    pairingToProc: '', pairingNullDept: '', pairingInactive: '',
  };
  let seq = 0;

  function makeDocuments(): DocumentService {
    const scope = new CompanyScopeService(orm.em);
    return new DocumentService(
      orm.em, scope, new DeptDocTypeService(orm.em), new NumberingService(orm.em),
      new ItemService(orm.em, scope, new ScopeService(), new AccountService(orm.em, scope)),
      new BudgetService(orm.em, new AccountService(orm.em, scope), new BudgetBalanceService(orm.em)),
      new FiscalYearService(scope),
    );
  }

  function makeSweeper(documents = makeDocuments()): SuccessorSweeper {
    return new SuccessorSweeper(orm.em, documents);
  }

  /** A PO raised from the source by hand, in Procurement, before any sweep. */
  function handRaisePo(procId: string): Promise<Document> {
    return RequestContext.run(
      { userId: ids.requester, companyId: ids.company, departmentId: ids.deptProc, grants: [] },
      () => makeDocuments().createFrom(procId, ids.poType),
    );
  }

  function makePostAction(): PostActionService {
    const balance = new BudgetBalanceService(orm.em);
    return new PostActionService(new BudgetLedgerService(orm.em, balance, new BudgetCoverageService(orm.em)), orm.em);
  }

  /** A COMPLETED source document raised by the requester, in the IT department. */
  async function seedSource(typeId: string): Promise<string> {
    const em = orm.em.fork();
    const d = em.create(Document, {
      docNo: `S-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.deptIt),
      documentType: em.getReference(DocumentType, typeId),
      formTemplate: em.getReference(FormTemplate, ids.procTmpl),
      workflow: em.getReference(Workflow, ids.wf),
      currentStepNo: 1,
      createdBy: em.getReference(AppUser, ids.requester),
      exchangeRate: '1',
      status: DocStatus.COMPLETED,
      submittedAt: new Date(),
      approvedAt: new Date(),
      createdAt: new Date(),
    });
    await em.flush();
    return d.id;
  }

  /** The approval's half: run the post-action in a transaction, as ApprovalRoutingService does. */
  async function recordObligations(documentId: string): Promise<void> {
    const postAction = makePostAction();
    await orm.em.fork().transactional(async (tem) => {
      const doc = await tem.findOneOrFail(
        Document,
        { id: documentId },
        { ...FILTER_OFF, populate: ['documentType', 'company', 'department'] },
      );
      await postAction.run(doc, tem);
    });
  }

  function rowsFor(documentId: string): Promise<PendingSuccessor[]> {
    return orm.em.fork().find(
      PendingSuccessor,
      { sourceDocument: documentId },
      { ...FILTER_OFF, populate: ['department', 'successorType'] },
    );
  }

  function successorsOf(documentId: string): Promise<Document[]> {
    return orm.em.fork().find(
      Document,
      { refDocument: documentId },
      { ...FILTER_OFF, populate: ['documentType', 'department', 'createdBy', 'workflow'] },
    );
  }

  /** Point the PROC→PO pairing at a department (or clear it) for the test at hand. */
  async function setSuccessorDepartment(departmentId: string | null): Promise<void> {
    const em = orm.em.fork();
    const pairing = await em.findOneOrFail(DocumentTypeRef, { id: ids.pairingToProc }, FILTER_OFF);
    pairing.successorDepartment = departmentId
      ? em.getReference(Department, departmentId)
      : undefined;
    await em.flush();
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();

    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    // Two departments: the one that asks, and the one that buys.
    const deptIt = em.create(Department, { company, deptCode: 'IT', name: 'IT', isActive: true });
    const deptProc = em.create(Department, { company, deptCode: 'PROC', name: 'Procurement', isActive: true });
    // A second company, to prove a pairing cannot hand a successor across companies.
    const otherCompany = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true });
    const otherDept = em.create(Department, { company: otherCompany, deptCode: 'OB', name: 'Other', isActive: true });

    const requester = em.create(AppUser, { username: 'requester', email: 'requester@x', status: 'ACTIVE' });
    const approver = em.create(AppUser, { username: 'approver', email: 'approver@x', status: 'ACTIVE' });

    const procType = em.create(DocumentType, { company, code: 'PROC', name: 'Procurement Req', category: DocCategory.PROCUREMENT, requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false, postAction: 'CREATE_SUCCESSOR', isActive: true });
    const poType = em.create(DocumentType, { company, code: 'PO', name: 'Purchase Order', category: DocCategory.PROCUREMENT, requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false, isActive: true });
    const inactiveType = em.create(DocumentType, { company, code: 'DEAD', name: 'Retired', category: DocCategory.PROCUREMENT, requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false, isActive: false });

    const procTmpl = em.create(FormTemplate, { documentType: procType, version: 1, status: 'PUBLISHED' });
    const poTmpl = em.create(FormTemplate, { documentType: poType, version: 1, status: 'PUBLISHED' });
    const deadTmpl = em.create(FormTemplate, { documentType: inactiveType, version: 1, status: 'PUBLISHED' });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });

    // PROC is raised in IT; PO is only enabled for Procurement — the realistic split, and the
    // reason inheriting the requester's department would strand the obligation in FAILED.
    em.create(DeptDocType, { department: deptIt, documentType: procType, formTemplate: procTmpl, workflow: wf, isActive: true });
    em.create(DeptDocType, { department: deptProc, documentType: poType, formTemplate: poTmpl, workflow: wf, isActive: true });
    em.create(DeptDocType, { department: deptProc, documentType: inactiveType, formTemplate: deadTmpl, workflow: wf, isActive: true });

    const pairingToProc = em.create(DocumentTypeRef, { company, predecessorType: procType, successorType: poType, autoCreate: true, successorDepartment: deptProc });
    const pairingInactive = em.create(DocumentTypeRef, { company, predecessorType: procType, successorType: inactiveType, autoCreate: true, successorDepartment: deptProc });

    await em.flush();
    Object.assign(ids, {
      company: company.id, deptIt: deptIt.id, deptProc: deptProc.id,
      otherCompany: otherCompany.id, otherDept: otherDept.id,
      requester: requester.id, approver: approver.id,
      procType: procType.id, poType: poType.id, inactiveType: inactiveType.id,
      procTmpl: procTmpl.id, poTmpl: poTmpl.id, wf: wf.id,
      pairingToProc: pairingToProc.id, pairingInactive: pairingInactive.id,
    });
  });

  beforeEach(async () => {
    // Each test owns the whole queue: scanPending drains everything, so leftovers would leak.
    await orm.em.fork().nativeDelete(PendingSuccessor, {}, FILTER_OFF);
    await setSuccessorDepartment(ids.deptProc);
  });

  // ---- Recording the obligation (atomic with the approval) -------------------

  it('records a PENDING obligation without creating the successor', async () => {
    const procId = await seedSource(ids.procType);

    await recordObligations(procId);

    const rows = await rowsFor(procId);
    // The inactive successor type owes nothing: an admin disabled it, so not creating it is
    // compliance, not a failure — keeping FAILED meaningful.
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(PendingSuccessorStatus.PENDING);
    expect(rows[0].successorType.code).toBe('PO');
    // createFrom needs the source COMPLETED, which it only is once this transaction commits.
    expect(await successorsOf(procId)).toHaveLength(0);
  });

  it('rolls the obligation back with the approval transaction', async () => {
    const procId = await seedSource(ids.procType);
    const postAction = makePostAction();

    await expect(
      orm.em.fork().transactional(async (tem) => {
        const doc = await tem.findOneOrFail(Document, { id: procId }, { ...FILTER_OFF, populate: ['documentType', 'company', 'department'] });
        await postAction.run(doc, tem);
        throw new Error('approval failed after the post-action');
      }),
    ).rejects.toThrow('approval failed after the post-action');

    // If the approval did not stand, nothing may be owed on its behalf.
    expect(await rowsFor(procId)).toHaveLength(0);
  });

  it('writes no budget or quota ledger row', async () => {
    const before = await orm.em.fork().count(BudgetTxn, {}, FILTER_OFF);
    const procId = await seedSource(ids.procType);

    await recordObligations(procId);
    await makeSweeper().scanPending();

    // The outbox is not a ledger and the successor is a DRAFT — holds are taken at its own submit.
    expect(await orm.em.fork().count(BudgetTxn, {}, FILTER_OFF)).toBe(before);
  });

  it('resolves the department when recording, so a later pairing edit cannot redirect it', async () => {
    const procId = await seedSource(ids.procType);
    await recordObligations(procId);
    expect((await rowsFor(procId))[0].department.id).toBe(ids.deptProc);

    // Re-point the pairing after the approval already granted the handoff.
    await setSuccessorDepartment(ids.deptIt);
    await makeSweeper().scanPending();

    const [po] = await successorsOf(procId);
    expect(po.department.id).toBe(ids.deptProc);
  });

  it('falls back to the source document department when the pairing names none', async () => {
    await setSuccessorDepartment(null);
    // IT cannot create a PO, so the obligation is owed to IT and will fail — which is exactly the
    // point: the fallback is only right for same-department chains.
    const procId = await seedSource(ids.procType);

    await recordObligations(procId);

    expect((await rowsFor(procId))[0].department.id).toBe(ids.deptIt);
  });

  // ---- The successor's identity ----------------------------------------------

  it('creates the successor in the configured department, with that department routing', async () => {
    const procId = await seedSource(ids.procType);
    await recordObligations(procId);

    await makeSweeper().scanPending();

    const [po] = await successorsOf(procId);
    expect(po.documentType.code).toBe('PO');
    expect(po.status).toBe(DocStatus.DRAFT);
    // Procurement's mapping is what pins the PO's form template and workflow.
    expect(po.department.id).toBe(ids.deptProc);
  });

  it('attributes the successor to the source requester, not the approver', async () => {
    const procId = await seedSource(ids.procType);
    await recordObligations(procId);

    await makeSweeper().scanPending();

    const [po] = await successorsOf(procId);
    // The old post-commit path ran inside the approver's request and inherited them, which under
    // invariant 8 silently barred that approver from ever approving the PO they had just caused.
    expect(po.createdBy?.id).toBe(ids.requester);
    expect(po.createdBy?.id).not.toBe(ids.approver);
  });

  it('needs no ambient request context', async () => {
    const procId = await seedSource(ids.procType);
    await recordObligations(procId);

    // The timer backstop fires with no request whatsoever; the obligation must be self-sufficient.
    expect(RequestContext.get()).toBeUndefined();
    await makeSweeper().scanPending();

    expect(await successorsOf(procId)).toHaveLength(1);
  });

  it('keeps the successor inside the source company', async () => {
    const procId = await seedSource(ids.procType);
    await recordObligations(procId);

    await makeSweeper().scanPending();

    const [po] = await successorsOf(procId);
    const fresh = await orm.em.fork().findOneOrFail(Document, { id: po.id }, { ...FILTER_OFF, populate: ['company'] });
    expect(fresh.company.id).toBe(ids.company);
    expect(fresh.company.id).not.toBe(ids.otherCompany);
  });

  // ---- Sweeping: DONE, retry, FAILED -----------------------------------------

  it('marks a fulfilled row DONE and does not fulfil it twice', async () => {
    const procId = await seedSource(ids.procType);
    await recordObligations(procId);
    const sweeper = makeSweeper();

    await sweeper.scanPending();
    await sweeper.scanPending();

    expect((await rowsFor(procId))[0].status).toBe(PendingSuccessorStatus.DONE);
    expect(await successorsOf(procId)).toHaveLength(1);
  });

  it('records a failure, leaves the row PENDING, and keeps the source COMPLETED', async () => {
    await setSuccessorDepartment(ids.deptIt); // IT has no PO mapping → createFrom rejects
    const procId = await seedSource(ids.procType);
    await recordObligations(procId);

    await makeSweeper().scanPending();

    const [row] = await rowsFor(procId);
    expect(row.status).toBe(PendingSuccessorStatus.PENDING);
    expect(row.attempts).toBe(1);
    expect(row.lastError).toMatch(/not enabled for department/);
    // The approval stands: a broken successor config must never undo it.
    const source = await orm.em.fork().findOneOrFail(Document, { id: procId }, FILTER_OFF);
    expect(source.status).toBe(DocStatus.COMPLETED);
  });

  it('parks a permanently failing row in FAILED and stops retrying', async () => {
    await setSuccessorDepartment(ids.deptIt);
    const procId = await seedSource(ids.procType);
    await recordObligations(procId);
    const sweeper = makeSweeper();

    for (let i = 0; i < MAX_ATTEMPTS; i++) await sweeper.scanPending();

    const [row] = await rowsFor(procId);
    expect(row.status).toBe(PendingSuccessorStatus.FAILED);
    expect(row.attempts).toBe(MAX_ATTEMPTS);

    // Further sweeps must not touch it — FAILED is stable enough to report on.
    await sweeper.scanPending();
    expect((await rowsFor(procId))[0].attempts).toBe(MAX_ATTEMPTS);
  });

  it('surfaces failed obligations with their source, type, and error', async () => {
    await setSuccessorDepartment(ids.deptIt);
    const procId = await seedSource(ids.procType);
    await recordObligations(procId);
    const sweeper = makeSweeper();
    for (let i = 0; i < MAX_ATTEMPTS; i++) await sweeper.scanPending();

    const failed = await orm.em.fork().find(
      PendingSuccessor,
      { status: PendingSuccessorStatus.FAILED },
      { ...FILTER_OFF, populate: ['sourceDocument', 'successorType'] },
    );

    // The whole point of the state: "what did approval promise and not deliver" is a query.
    expect(failed).toHaveLength(1);
    expect(failed[0].sourceDocument.id).toBe(procId);
    expect(failed[0].successorType.code).toBe('PO');
    expect(failed[0].lastError).toBeTruthy();
  });

  it('recovers once the configuration is fixed', async () => {
    await setSuccessorDepartment(ids.deptIt);
    const procId = await seedSource(ids.procType);
    await recordObligations(procId);
    const sweeper = makeSweeper();
    await sweeper.scanPending();
    expect(await successorsOf(procId)).toHaveLength(0);

    // The obligation is durable, so enabling PO for IT lets the next sweep deliver it.
    const em = orm.em.fork();
    const wf = em.getReference(Workflow, ids.wf);
    em.create(DeptDocType, {
      department: em.getReference(Department, ids.deptIt),
      documentType: em.getReference(DocumentType, ids.poType),
      formTemplate: em.getReference(FormTemplate, ids.poTmpl),
      workflow: wf,
      isActive: true,
    });
    await em.flush();

    await sweeper.scanPending();

    expect(await successorsOf(procId)).toHaveLength(1);
    expect((await rowsFor(procId))[0].status).toBe(PendingSuccessorStatus.DONE);
  });

  // ---- An existing successor meets the obligation ----------------------------

  it('marks the row DONE when the successor was raised by hand before the sweep', async () => {
    const procId = await seedSource(ids.procType);
    await recordObligations(procId);
    const po = await handRaisePo(procId);

    await makeSweeper().scanPending();

    const [row] = await rowsFor(procId);
    expect(row.status).toBe(PendingSuccessorStatus.DONE);
    expect(row.attempts).toBe(0);
    expect(row.lastError).toBeFalsy();
    const successors = await successorsOf(procId);
    expect(successors.map((d) => d.id)).toEqual([po.id]);
  });

  it('fills the slot a cancelled hand-raised successor freed', async () => {
    const procId = await seedSource(ids.procType);
    await recordObligations(procId);
    const po = await handRaisePo(procId);
    const em = orm.em.fork();
    const cancelled = await em.findOneOrFail(Document, { id: po.id }, FILTER_OFF);
    cancelled.status = DocStatus.CANCELLED;
    await em.flush();

    await makeSweeper().scanPending();

    expect((await rowsFor(procId))[0].status).toBe(PendingSuccessorStatus.DONE);
    const live = (await successorsOf(procId)).filter((d) => d.status !== DocStatus.CANCELLED);
    expect(live).toHaveLength(1);
    expect(live[0].id).not.toBe(po.id);
  });

  it('treats losing the creation race to a manual create-from as transient, then meets it', async () => {
    const procId = await seedSource(ids.procType);
    await recordObligations(procId);
    const po = await handRaisePo(procId);
    // Deterministic race: both reads that would have seen the manual PO — the sweep's own and the
    // service's — ran before it was committed, so only the partial unique index refuses the insert.
    const documents = makeDocuments();
    vi.spyOn(documents as unknown as { liveSuccessor: () => Promise<string | null> }, 'liveSuccessor')
      .mockResolvedValueOnce(null);
    const stale = makeSweeper(documents);
    vi.spyOn(stale as unknown as { alreadyRaised: () => Promise<Document | null> }, 'alreadyRaised')
      .mockResolvedValueOnce(null);

    await stale.scanPending();

    let [row] = await rowsFor(procId);
    expect(row.status).toBe(PendingSuccessorStatus.PENDING);
    expect(row.attempts).toBe(1);
    expect(row.lastError).toMatch(/already has PO/);
    expect((await successorsOf(procId)).map((d) => d.id)).toEqual([po.id]);

    await makeSweeper().scanPending();

    [row] = await rowsFor(procId);
    expect(row.status).toBe(PendingSuccessorStatus.DONE);
    expect((await successorsOf(procId)).map((d) => d.id)).toEqual([po.id]);
  });

  // ---- Concurrency -----------------------------------------------------------

  it('creates exactly one successor when two sweepers race one obligation', async () => {
    const procId = await seedSource(ids.procType);
    await recordObligations(procId);

    // The claim is FOR UPDATE SKIP LOCKED, so the loser skips the row rather than duplicating it.
    // Document numbering's own lock would NOT save us here: it only gives two POs two numbers.
    await Promise.all([makeSweeper().scanPending(), makeSweeper().scanPending()]);

    expect(await successorsOf(procId)).toHaveLength(1);
    expect((await rowsFor(procId))[0].status).toBe(PendingSuccessorStatus.DONE);
  });

  it('creates one successor each when many sweepers race many obligations', async () => {
    const ids1 = await seedSource(ids.procType);
    const ids2 = await seedSource(ids.procType);
    await recordObligations(ids1);
    await recordObligations(ids2);

    await Promise.all([
      makeSweeper().scanPending(),
      makeSweeper().scanPending(),
      makeSweeper().scanPending(),
    ]);

    expect(await successorsOf(ids1)).toHaveLength(1);
    expect(await successorsOf(ids2)).toHaveLength(1);
    const all = await orm.em.fork().find(PendingSuccessor, {}, FILTER_OFF);
    expect(all.every((r) => r.status === PendingSuccessorStatus.DONE)).toBe(true);
  });
});

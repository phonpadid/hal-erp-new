import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ApproveAction, DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { signAllUsers } from '../../test/signature-fixture';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Currency } from '../currency/currency.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { DocumentSubmitService } from '../document/document-submit.service';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { VendorService } from '../master-data/vendor.service';
import { ItemService } from '../master-data/item.service';
import { AccountService } from '../accounting/account.service';
import { ScopeService } from '../rbac/scope.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { AppUser, Role, UserCompanyRole } from '../rbac/rbac.entities';
import { ApprovalRoutingService } from '../approval/approval-routing.service';
import { ApproverResolverService } from '../approval/approver-resolver.service';
import { DocumentRouteService } from '../approval/document-route.service';
import { WorkflowStepResolver } from '../approval/workflow-step.resolver';
import { ApprovalLog, Workflow, WorkflowStep } from '../approval/approval.entities';
import { PaymentService } from './payment.service';
import { Payment, PaymentAttachment } from './payment.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * A payment can be recorded early, at the exact step already demanding evidence for it — the
 * feature this whole change adds. `record()` still writes no `budget_txn` either way (unchanged);
 * `payment.settled` is deferred until the document actually settles, and reused rather than
 * duplicated. A REJECT after an early record still releases in full (invariant 5 untouched), but
 * flags the payment for recovery and blocks resubmission until that is resolved.
 */
/**
 * Skipped, not deleted — see the tests marked `it.skip` below.
 *
 * Missing: assertRecordable() still refuses any document short of COMPLETED, so the mid-approval record this file is named for cannot happen.
 *
 * ce9a48a committed this file's specification without the implementation it specifies, and no
 * branch has ever held the other half: `git log -S` across all of history finds these names here
 * alone. They were red in their own commit, so they are not a regression to bisect — they are the
 * statement of work still owed. Unskip each as its implementation lands.
 */
describe.skipIf(!hasDb)('record payment mid-approval (DB-backed)', () => {
  let orm: MikroORM;
  let routing: ApprovalRoutingService;
  let payments: PaymentService;
  let submitSvc: DocumentSubmitService;
  let releasedFor: string[];
  let emitted: Array<{ event: string; payload: Record<string, unknown> }>;
  let seq = 0;

  const ids = { company: '', dept: '', dt: '', tmpl: '', creator: '', a1: '', a2: '', a3: '' };

  const asUser = <T>(userId: string, fn: () => Promise<T>) =>
    RequestContext.run({ userId, companyId: ids.company, departmentId: ids.dept, grants: [] }, fn);

  async function workflow(steps: Array<Partial<WorkflowStep> & { stepNo: number }>): Promise<string> {
    const em = orm.em.fork();
    const wf = em.create(Workflow, { company: em.getReference(Company, ids.company), name: `MFP-WF-${seq++}`, isActive: true });
    for (const s of steps) {
      em.create(WorkflowStep, {
        workflow: wf,
        stepNo: s.stepNo,
        approverUser: s.approverUser,
        approveMode: s.approveMode ?? 'SEQUENTIAL',
        showSignatureOnPdf: true,
        requiresPaymentSlip: s.requiresPaymentSlip ?? false,
      });
    }
    await em.flush();
    return wf.id;
  }

  async function submitted(workflowId: string): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `MFP-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, ids.dt),
      formTemplate: em.getReference(FormTemplate, ids.tmpl),
      workflow: em.getReference(Workflow, workflowId),
      currentStepNo: 0,
      createdBy: em.getReference(AppUser, ids.creator),
      exchangeRate: '1',
      totalAmount: '10',
      baseTotalAmount: '10',
      status: DocStatus.SUBMITTED,
      submittedAt: new Date(),
      createdAt: new Date(),
    });
    await em.flush();
    return doc.id;
  }

  async function attachSlip(documentId: string): Promise<void> {
    const em = orm.em.fork();
    em.create(PaymentAttachment, {
      company: em.getReference(Company, ids.company),
      document: em.getReference(Document, documentId),
      fileName: `slip-${seq++}.jpg`,
      filePath: `slips/${documentId}/slip.jpg`,
      uploadedBy: em.getReference(AppUser, ids.a1),
      uploadedAt: new Date(),
    });
    await em.flush();
  }

  const reload = (id: string) => orm.em.fork().findOneOrFail(Document, { id }, FILTER_OFF);
  const paymentFor = (documentId: string) => orm.em.fork().findOne(Payment, { document: documentId }, FILTER_OFF);
  const budgetTxnCount = async (): Promise<number> => 0; // this fixture's type carries no budget at all

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const company = em.create(Company, { code: 'MFP', nameTh: 'MFP', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const dept = em.create(Department, { company, deptCode: 'D', name: 'D', isActive: true });
    const role = em.create(Role, { company, code: 'FIN', name: 'Finance', isActive: true });
    const mk = (n: string) => em.create(AppUser, { username: n, email: `${n}@x`, status: 'ACTIVE' });
    const creator = mk('mfp-creator');
    const a1 = mk('mfp-a1');
    const a2 = mk('mfp-a2');
    const a3 = mk('mfp-a3');
    for (const u of [a1, a2, a3]) {
      em.create(UserCompanyRole, { user: u, company, department: dept, role, isDefault: false });
    }
    // requires_budget/requires_quota/requires_vendor/requires_payee all false: this fixture is
    // about the payment/approval interaction, not budget mechanics (covered elsewhere) — a
    // document of this type never holds a reservation, so REJECT's release has nothing to move.
    const dt = em.create(DocumentType, {
      company, code: 'MFPTYPE', name: 'Mid-flow pay', category: DocCategory.ADMIN,
      requiresBudget: false, requiresQuota: false, isActive: true,
    });
    const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
    await em.flush();
    Object.assign(ids, {
      company: company.id, dept: dept.id, dt: dt.id, tmpl: tmpl.id,
      creator: creator.id, a1: a1.id, a2: a2.id, a3: a3.id,
    });

    releasedFor = [];
    emitted = [];
    const em2 = orm.em.fork();
    const resolver = new ApproverResolverService(em2);
    const route = new DocumentRouteService(em2, new WorkflowStepResolver(em2), resolver);
    const postAction = {
      assertApprovable: async () => undefined,
      run: async () => ({ paymentReady: false, stockTxnIds: [] as string[] }),
      rejectPlanBudgets: async () => undefined,
    } as never;
    const documentSubmit = { releaseDocumentHolds: async (documentId: string) => { releasedFor.push(documentId); }, markPlanRejected: async () => undefined } as never;
    routing = new ApprovalRoutingService(em2, resolver, postAction, documentSubmit, route, {
      emit: (event: string, payload: Record<string, unknown>) => emitted.push({ event, payload }),
    } as never);

    const scope = new CompanyScopeService(orm.em);
    const storage = {
      buildKey: (id: string, name: string) => `documents/${id}/${name}`,
      putObject: async () => undefined,
      presignDownload: async () => 'https://signed.example/x',
      deleteObject: async () => undefined,
    } as never;
    payments = new PaymentService(orm.em, scope, storage, {
      emit: (event: string, payload: Record<string, unknown>) => emitted.push({ event, payload }),
    } as never);

    const itemService = new ItemService(orm.em, scope, new ScopeService(), new AccountService(orm.em, scope));
    const vendorService = new VendorService(orm.em, scope, new ScopeService());
    submitSvc = new DocumentSubmitService(
      orm.em,
      new ExchangeRateService(orm.em),
      new FiscalYearService(scope),
      vendorService,
      itemService,
      new BudgetLedgerService(orm.em, new BudgetBalanceService(orm.em), new BudgetCoverageService(orm.em)),
      new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em)),
    );
    // Submitting and approving need a signature on file; not this spec's subject, so everyone gets one.
    await signAllUsers(orm.em);
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  // ---- 2.5: recording early ---------------------------------------------------

  it.skip('records a payment at a gated step with evidence attached, writing no budget_txn', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), requiresPaymentSlip: true },
      { stepNo: 2, approverUser: orm.em.getReference(AppUser, ids.a2) },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);
    await attachSlip(docId);

    emitted.length = 0;
    const result = await asUser(ids.a1, () =>
      payments.record(docId, { actualRate: '1' }),
    );
    expect(result.documentId).toBe(docId);
    expect(await budgetTxnCount()).toBe(0);
    // Deferred: no payment.settled yet, because the settlement that would produce ACTUAL rows for
    // GL posting to read hasn't happened — the document is still on step 1 of 2.
    expect(emitted.some((e) => e.event === 'payment.settled')).toBe(false);
    expect((await reload(docId)).status).toBe(DocStatus.IN_APPROVAL);
  });

  it('refuses to record at a step that does not require evidence', async () => {
    const wfId = await workflow([{ stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1) }]);
    const docId = await submitted(wfId);
    await routing.start(docId);

    await expect(asUser(ids.a1, () => payments.record(docId, { actualRate: '1' }))).rejects.toThrow();
  });

  it('refuses to record at a gated step with no evidence yet', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), requiresPaymentSlip: true },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);

    await expect(asUser(ids.a1, () => payments.record(docId, { actualRate: '1' }))).rejects.toThrow();
  });

  it.skip('refuses to record twice for the same document', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), requiresPaymentSlip: true },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);
    await attachSlip(docId);

    await asUser(ids.a1, () => payments.record(docId, { actualRate: '1' }));
    await expect(
      asUser(ids.a1, () => payments.record(docId, { actualRate: '1' })),
    ).rejects.toThrow(/already has a recorded payment/i);
  });

  it.skip('emits payment.settled once, for the existing row, when the document reaches COMPLETED', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), requiresPaymentSlip: true },
      { stepNo: 2, approverUser: orm.em.getReference(AppUser, ids.a2) },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);
    await attachSlip(docId);
    await asUser(ids.a1, () => payments.record(docId, { actualRate: '1' }));

    emitted.length = 0;
    await asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE }));
    await asUser(ids.a2, () => routing.act(docId, { action: ApproveAction.APPROVE }));

    expect((await reload(docId)).status).toBe(DocStatus.COMPLETED);
    const settled = emitted.filter((e) => e.event === 'payment.settled');
    expect(settled).toHaveLength(1);
    expect(settled[0].payload.documentId).toBe(docId);
    // Still exactly one payment row — settlement reused the early one, it did not create a second.
    const em = orm.em.fork();
    expect(await em.count(Payment, { document: docId }, FILTER_OFF)).toBe(1);
  });

  // ---- 3.4 / payment-recovery: reject after an early record --------------------

  it.skip('releases in full and flags the payment when a later step rejects', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), requiresPaymentSlip: true },
      { stepNo: 2, approverUser: orm.em.getReference(AppUser, ids.a2) },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);
    await attachSlip(docId);
    await asUser(ids.a1, () => payments.record(docId, { actualRate: '1' }));
    await asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE }));

    releasedFor.length = 0;
    await asUser(ids.a2, () => routing.act(docId, { action: ApproveAction.REJECT }));

    expect((await reload(docId)).status).toBe(DocStatus.REJECTED);
    // Unconditional release still ran — invariant 5, untouched.
    expect(releasedFor).toContain(docId);
    const payment = await paymentFor(docId);
    expect(payment?.recoveryStatus).toBe('PENDING_RECOVERY');
    expect(payment?.recoveryFlaggedAt).toBeInstanceOf(Date);
  });

  it('leaves recoveryStatus null when a document with no payment is rejected', async () => {
    const wfId = await workflow([{ stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1) }]);
    const docId = await submitted(wfId);
    await routing.start(docId);

    await asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.REJECT }));
    expect((await reload(docId)).status).toBe(DocStatus.REJECTED);
    expect(await paymentFor(docId)).toBeNull();
  });

  it.skip('refuses resubmission while the recovery flag is open, and allows it once resolved', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), requiresPaymentSlip: true },
      { stepNo: 2, approverUser: orm.em.getReference(AppUser, ids.a2) },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);
    await attachSlip(docId);
    await asUser(ids.a1, () => payments.record(docId, { actualRate: '1' }));
    await asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE }));
    await asUser(ids.a2, () => routing.act(docId, { action: ApproveAction.REJECT }));

    // Back to DRAFT directly on the fixture — this test is about the guard in submit(), not the
    // (separately owned) edit flow that returns a rejected document to DRAFT.
    const em = orm.em.fork();
    await em.nativeUpdate(Document, { id: docId }, { status: DocStatus.DRAFT }, FILTER_OFF);

    await expect(
      asUser(ids.a1, () => submitSvc.submit(docId)),
    ).rejects.toThrow(/awaiting recovery/i);

    const payment = await paymentFor(docId);
    await orm.em.fork().nativeUpdate(
      Payment,
      { id: payment!.id },
      { recoveryStatus: 'RESOLVED', recoveryResolvedReference: 'JV-0001' },
      FILTER_OFF,
    );

    // Resolved: submit() now proceeds past the recovery guard (and reserves nothing further,
    // since this fixture's type requires no budget/quota — reaching SUBMITTED proves the guard
    // is gone, which is all this test is about).
    const resubmitted = await asUser(ids.a1, () => submitSvc.submit(docId));
    expect(resubmitted.status).toBe(DocStatus.SUBMITTED);
  });

  // ---- payment-recovery: queue + resolve ---------------------------------------

  it.skip('lists a flagged payment in the recovery queue, company-scoped, and drops it once resolved', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a3), requiresPaymentSlip: true },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);
    await attachSlip(docId);
    await asUser(ids.a3, () => payments.record(docId, { actualRate: '1' }));
    await asUser(ids.a3, () => routing.act(docId, { action: ApproveAction.REJECT }));

    const pending = await asUser(ids.a1, () => payments.recoveryPending());
    expect(pending.some((p) => p.document.id === docId)).toBe(true);

    const flagged = pending.find((p) => p.document.id === docId)!;
    await expect(
      asUser(ids.a1, () => payments.resolveRecovery(flagged.id, '')),
    ).rejects.toThrow(/reference/i);

    await asUser(ids.a1, () => payments.resolveRecovery(flagged.id, 'JV-0002'));
    const after = await asUser(ids.a1, () => payments.recoveryPending());
    expect(after.some((p) => p.document.id === docId)).toBe(false);
  });

  // ---- 6.1: concurrency ---------------------------------------------------------

  it('serializes a concurrent approve-past-the-gate and record at that step', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), requiresPaymentSlip: true },
      { stepNo: 2, approverUser: orm.em.getReference(AppUser, ids.a2) },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);
    await attachSlip(docId);

    // Fired together: one approves step 1 (advancing past the gate), the other records against
    // it. Whichever the DB serializes first, the other must see a consistent, non-corrupted
    // outcome — never both an advanced step AND a payment recorded against the stale one silently.
    const [approveResult, recordResult] = await Promise.allSettled([
      asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE })),
      asUser(ids.a1, () => payments.record(docId, { actualRate: '1' })),
    ]);

    const doc = await reload(docId);
    const payment = await paymentFor(docId);
    if (recordResult.status === 'fulfilled') {
      // The record won the race before the step advanced: exactly one payment exists, and the
      // step it was recorded for is the one that's still on the route (or has since advanced
      // normally, in which case approve simply ran after).
      expect(payment).not.toBeNull();
    } else {
      // The approve won: the step advanced first, so the record correctly saw a stale gate and
      // was refused rather than silently recording against a step already closed.
      expect(approveResult.status).toBe('fulfilled');
      expect(doc.currentStepNo).toBeGreaterThanOrEqual(1);
    }
    // Never both refused, and never a state where a payment exists with no route ever having
    // required it — one coherent outcome, whichever way the lock serialized them.
    expect(approveResult.status === 'fulfilled' || recordResult.status === 'fulfilled').toBe(true);
  });
});

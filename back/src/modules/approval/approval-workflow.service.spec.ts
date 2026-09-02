import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attachCoverage, budgetAt } from '../../test/budget-fixture';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ApproveAction, DocCategory, DocStatus, PendingSuccessorStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { BudgetService } from '../budget/budget.service';
import { AccountService } from '../accounting/account.service';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { DocumentSubmitService } from '../document/document-submit.service';
import { DocumentService } from '../document/document.service';
import { DeptDocTypeService } from '../document/dept-doc-type.service';
import { NumberingService } from '../document/numbering.service';
import {
  DeptDocType,
  Document,
  DocumentLine,
  DocumentType,
  DocumentTypeRef,
  FormTemplate,
} from '../document/document.entities';
import { ItemService } from '../master-data/item.service';
import { VendorService } from '../master-data/vendor.service';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { WorkingTimeService } from '../multi-company/working-time.service';
import {
  Company,
  Department,
  FiscalYear,
  HolidayCalendar,
} from '../multi-company/multi-company.entities';
import { AppUser, Employee, Role, UserCompanyRole, UserSignature } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import { ApprovalRoutingService } from './approval-routing.service';
import { DocumentRouteService } from './document-route.service';
import { ApproverResolverService } from './approver-resolver.service';
import {
  ApprovalDelegation,
  ApprovalLog,
  PendingSuccessor,
  Workflow,
  WorkflowStep,
} from './approval.entities';
import { PostActionService } from './post-action.service';
import { SuccessorSweeper } from './successor-sweeper.service';
import { WorkflowStepResolver } from './workflow-step.resolver';
import { SlaService } from './sla.service';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

// `budget_txn.txn_date` is the day of the event and is not nullable; a fixture states one just
// as the ledger service does.
const TODAY = new Date().toISOString().slice(0, 10);

const hasDb = await dbAvailable();
const FAR = '2999-12-31';

function asUser<T>(userId: string, companyId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run({ userId, companyId, departmentId: 'd', grants: [] }, fn);
}

describe.skipIf(!hasDb)('approval-workflow (DB-backed)', () => {
  let orm: MikroORM;
  let routing: ApprovalRoutingService;
  let sla: SlaService;
  let budgetBalance: BudgetBalanceService;

  const ids = {
    companyA: '', deptA: '', fyA: '', role: '',
    creator: '', ua: '', ua2: '', r1: '', r2: '', r3: '', delegator: '', delegate: '', delegateChain: '',
    dtPlain: '', dtCut: '', tmplPlain: '', tmplCut: '', bA1: '',
    advType: '', claType: '', advTmpl: '', wfCla: '', orphanType: '', orphTmpl: '',
  };
  let seq = 0;

  async function seedDoc(
    opts: { workflowId: string; base: string; createdBy: string; cut?: boolean },
    extra?: (em: EntityManager, doc: Document) => void,
  ): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `D-${seq++}`,
      company: em.getReference(Company, ids.companyA),
      department: em.getReference(Department, ids.deptA),
      documentType: em.getReference(DocumentType, opts.cut ? ids.dtCut : ids.dtPlain),
      formTemplate: em.getReference(FormTemplate, opts.cut ? ids.tmplCut : ids.tmplPlain),
      workflow: em.getReference(Workflow, opts.workflowId),
      currentStepNo: 0,
      createdBy: em.getReference(AppUser, opts.createdBy),
      exchangeRate: '1',
      totalAmount: opts.base,
      baseTotalAmount: opts.base,
      status: DocStatus.SUBMITTED,
      submittedAt: new Date(),
      createdAt: new Date(),
    });
    if (extra) extra(em, doc);
    await em.flush();
    return doc.id;
  }

  async function workflow(steps: Array<Partial<WorkflowStep> & { stepNo: number }>): Promise<string> {
    const em = orm.em.fork();
    const wf = em.create(Workflow, { company: em.getReference(Company, ids.companyA), name: `WF-${seq++}`, isActive: true });
    for (const s of steps) {
      em.create(WorkflowStep, {
        workflow: wf,
        stepNo: s.stepNo,
        approverUser: s.approverUser,
        approverRole: s.approverRole,
        amountMin: s.amountMin,
        amountMax: s.amountMax,
        approveMode: s.approveMode ?? 'SEQUENTIAL',
        slaHours: s.slaHours,
        escalateToUser: s.escalateToUser,
        escalateToRole: s.escalateToRole,
        conditionJson: s.conditionJson,
      });
    }
    await em.flush();
    return wf.id;
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const companyA = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const deptA = em.create(Department, { company: companyA, deptCode: 'DA', name: 'DA', isActive: true });
    const fyA = em.create(FiscalYear, { company: companyA, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const role = em.create(Role, { company: companyA, code: 'APPROVER', name: 'Approver', isActive: true });

    const mkUser = (n: string) => em.create(AppUser, { username: n, email: `${n}@x`, status: 'ACTIVE' });
    const creator = mkUser('creator');
    const ua = mkUser('ua');
    const ua2 = mkUser('ua2');
    const r1 = mkUser('r1');
    const r2 = mkUser('r2');
    const r3 = mkUser('r3');
    const delegator = mkUser('delegator');
    const delegate = mkUser('delegate');
    const delegateChain = mkUser('delegateChain');
    for (const u of [r1, r2, r3]) {
      em.create(UserCompanyRole, { user: u, company: companyA, department: deptA, role, isDefault: false });
    }

    const dtPlain = em.create(DocumentType, { company: companyA, code: 'MEMO', name: 'Memo', category: DocCategory.ADMIN, requiresBudget: false, requiresQuota: false, isActive: true });
    const dtCut = em.create(DocumentType, { company: companyA, code: 'PR', name: 'PR', category: DocCategory.PROCUREMENT, requiresBudget: true, requiresQuota: false, postAction: 'CUT_BUDGET', isActive: true });
    const tmplPlain = em.create(FormTemplate, { documentType: dtPlain, version: 1, status: 'PUBLISHED' });
    const tmplCut = em.create(FormTemplate, { documentType: dtCut, version: 1, status: 'PUBLISHED' });
    const bA1 = budgetAt(em, { fiscalYear: fyA, department: deptA, code: 'GL1', glAccount: 'GL1', amountTotal: '1000000', status: 'ACTIVE' });
    attachCoverage(em, companyA, bA1);

    // CREATE_SUCCESSOR chain via ADVANCE → CLEAR_ADVANCE (avoids the unique code 'PR' used above).
    const advType = em.create(DocumentType, { company: companyA, code: 'ADVANCE', name: 'Advance', category: DocCategory.FINANCE, requiresBudget: false, requiresQuota: false, postAction: 'CREATE_SUCCESSOR', isActive: true });
    const claType = em.create(DocumentType, { company: companyA, code: 'CLEAR_ADVANCE', name: 'Clear Advance', category: DocCategory.FINANCE, requiresBudget: false, requiresQuota: false, isActive: true });
    const advTmpl = em.create(FormTemplate, { documentType: advType, version: 1, status: 'PUBLISHED' });
    const claTmpl = em.create(FormTemplate, { documentType: claType, version: 1, status: 'PUBLISHED' });
    const wfCla = em.create(Workflow, { company: companyA, name: 'WF-CLA', isActive: true });
    em.create(WorkflowStep, { workflow: wfCla, stepNo: 1, approverRole: role, approveMode: 'SEQUENTIAL' });
    em.create(DeptDocType, { department: deptA, documentType: claType, formTemplate: claTmpl, workflow: wfCla, isActive: true });
    // ADVANCE→CLEAR_ADVANCE pairing marked auto_create (now document_type_ref data). ORPHAN gets no
    // pairing, so its CREATE_SUCCESSOR must no-op.
    em.create(DocumentTypeRef, { company: companyA, predecessorType: advType, successorType: claType, autoCreate: true });
    // A second auto_create successor of ADVANCE → CREATE_SUCCESSOR must create BOTH.
    const claType2 = em.create(DocumentType, { company: companyA, code: 'CLEAR_ADVANCE2', name: 'Clear Advance 2', category: DocCategory.FINANCE, requiresBudget: false, requiresQuota: false, isActive: true });
    const claTmpl2 = em.create(FormTemplate, { documentType: claType2, version: 1, status: 'PUBLISHED' });
    em.create(DeptDocType, { department: deptA, documentType: claType2, formTemplate: claTmpl2, workflow: wfCla, isActive: true });
    em.create(DocumentTypeRef, { company: companyA, predecessorType: advType, successorType: claType2, autoCreate: true });
    // A manual (auto_create=false) successor of ADVANCE must NOT be auto-created.
    const manualType = em.create(DocumentType, { company: companyA, code: 'MANUAL_SUCC', name: 'Manual Successor', category: DocCategory.FINANCE, requiresBudget: false, requiresQuota: false, isActive: true });
    const manualTmpl = em.create(FormTemplate, { documentType: manualType, version: 1, status: 'PUBLISHED' });
    em.create(DeptDocType, { department: deptA, documentType: manualType, formTemplate: manualTmpl, workflow: wfCla, isActive: true });
    em.create(DocumentTypeRef, { company: companyA, predecessorType: advType, successorType: manualType, autoCreate: false });
    // A CREATE_SUCCESSOR type whose code has no auto_create successor → must no-op.
    const orphanType = em.create(DocumentType, { company: companyA, code: 'ORPHAN', name: 'Orphan', category: DocCategory.ADMIN, requiresBudget: false, requiresQuota: false, postAction: 'CREATE_SUCCESSOR', isActive: true });
    const orphTmpl = em.create(FormTemplate, { documentType: orphanType, version: 1, status: 'PUBLISHED' });

    await em.flush();
    Object.assign(ids, {
      companyA: companyA.id, deptA: deptA.id, fyA: fyA.id, role: role.id,
      creator: creator.id, ua: ua.id, ua2: ua2.id, r1: r1.id, r2: r2.id, r3: r3.id,
      delegator: delegator.id, delegate: delegate.id, delegateChain: delegateChain.id,
      dtPlain: dtPlain.id, dtCut: dtCut.id, tmplPlain: tmplPlain.id, tmplCut: tmplCut.id, bA1: bA1.id,
      advType: advType.id, claType: claType.id, advTmpl: advTmpl.id, wfCla: wfCla.id,
      orphanType: orphanType.id, orphTmpl: orphTmpl.id,
    });
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  beforeEach(() => {
    const scope = new CompanyScopeService(orm.em);
    const resolver = new ApproverResolverService(orm.em);
    budgetBalance = new BudgetBalanceService(orm.em);
    const budgetLedger = new BudgetLedgerService(orm.em, budgetBalance, new BudgetCoverageService(orm.em));
    const quotaUsage = new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em));
    const documentSubmit = new DocumentSubmitService(
      orm.em,
      new ExchangeRateService(orm.em),
      new FiscalYearService(scope),
      new VendorService(orm.em, scope, new ScopeService()),
      new ItemService(orm.em, scope, new ScopeService(), new AccountService(orm.em, scope)),
      budgetLedger,
      quotaUsage,
    );
    const stepResolver = new WorkflowStepResolver(orm.em);
    const routeSvc = new DocumentRouteService(orm.em, stepResolver, resolver);
    const documentService = new DocumentService(
      orm.em,
      scope,
      new DeptDocTypeService(orm.em),
      new NumberingService(orm.em),
      new ItemService(orm.em, scope, new ScopeService(), new AccountService(orm.em, scope)),
      new BudgetService(orm.em, new AccountService(orm.em, scope), new BudgetBalanceService(orm.em)),
      new FiscalYearService(scope),
    );
    routing = new ApprovalRoutingService(
      orm.em,
      resolver,
      new PostActionService(budgetLedger, orm.em, documentService),
      documentSubmit,
      routeSvc,
    );
    sla = new SlaService(orm.em, new WorkingTimeService(scope), resolver, routeSvc);
  });

  const ref = <T>(cls: new (...a: any[]) => T, id: string) => orm.em.getReference(cls as any, id) as any;
  const reload = (id: string) => orm.em.fork().findOneOrFail(Document, { id }, { filters: { company: false } });

  // ---- 8.1 Amount band -------------------------------------------------------

  it('includes the higher step only when the amount band warrants it', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: ref(AppUser, ids.ua) },
      { stepNo: 2, approverUser: ref(AppUser, ids.ua2), amountMin: '500000' },
    ]);

    const bigId = await seedDoc({ workflowId: wfId, base: '600000', createdBy: ids.creator });
    await routing.start(bigId);
    await asUser(ids.ua, ids.companyA, () => routing.act(bigId, { action: ApproveAction.APPROVE }));
    expect((await reload(bigId)).currentStepNo).toBe(2);

    const smallId = await seedDoc({ workflowId: wfId, base: '400000', createdBy: ids.creator });
    await routing.start(smallId);
    await asUser(ids.ua, ids.companyA, () => routing.act(smallId, { action: ApproveAction.APPROVE }));
    expect((await reload(smallId)).status).toBe(DocStatus.COMPLETED);
  });

  // ---- 8.2 Modes -------------------------------------------------------------

  it('PARALLEL_ANY advances on first approval; PARALLEL_ALL waits for all', async () => {
    const anyWf = await workflow([{ stepNo: 1, approverRole: ref(Role, ids.role), approveMode: 'PARALLEL_ANY' }]);
    const anyId = await seedDoc({ workflowId: anyWf, base: '10', createdBy: ids.creator });
    await routing.start(anyId);
    await asUser(ids.r1, ids.companyA, () => routing.act(anyId, { action: ApproveAction.APPROVE }));
    expect((await reload(anyId)).status).toBe(DocStatus.COMPLETED);

    const allWf = await workflow([{ stepNo: 1, approverRole: ref(Role, ids.role), approveMode: 'PARALLEL_ALL' }]);
    const allId = await seedDoc({ workflowId: allWf, base: '10', createdBy: ids.creator });
    await routing.start(allId);
    await asUser(ids.r1, ids.companyA, () => routing.act(allId, { action: ApproveAction.APPROVE }));
    expect((await reload(allId)).status).toBe(DocStatus.IN_APPROVAL);
    await asUser(ids.r2, ids.companyA, () => routing.act(allId, { action: ApproveAction.APPROVE }));
    await asUser(ids.r3, ids.companyA, () => routing.act(allId, { action: ApproveAction.APPROVE }));
    expect((await reload(allId)).status).toBe(DocStatus.COMPLETED);
  });

  // ---- 8.3 Role resolution ---------------------------------------------------

  it('resolves a role step to its holders', async () => {
    const wfId = await workflow([{ stepNo: 1, approverRole: ref(Role, ids.role) }]);
    const docId = await seedDoc({ workflowId: wfId, base: '10', createdBy: ids.creator });
    await routing.start(docId);
    await asUser(ids.r2, ids.companyA, () => routing.act(docId, { action: ApproveAction.APPROVE }));
    expect((await reload(docId)).status).toBe(DocStatus.COMPLETED);
  });

  it('routes a document through all 7 chain steps (submit → APPROVED → COMPLETED)', async () => {
    // Seven distinct roles, each held by a distinct approver — mirrors the seed's Full
    // Approval Chain: หัวหน้าแผนก → งบ → ประธาน → การเงิน → หน.การเงิน → บัญชี → หน.บัญชี.
    const em = orm.em.fork();
    const chain = ['DEPT_HEAD', 'BUDGET_OFFICER', 'PRESIDENT', 'FINANCE', 'FINANCE_HEAD', 'ACCOUNTING', 'ACCOUNTING_HEAD'];
    const roles = chain.map((code) =>
      em.create(Role, { company: em.getReference(Company, ids.companyA), code: `CH_${code}`, name: code, isActive: true }),
    );
    const users = chain.map((code) =>
      em.create(AppUser, { username: `chain_${code.toLowerCase()}`, email: `chain_${code.toLowerCase()}@x`, status: 'ACTIVE' }),
    );
    chain.forEach((_, i) =>
      em.create(UserCompanyRole, {
        user: users[i],
        company: em.getReference(Company, ids.companyA),
        department: em.getReference(Department, ids.deptA),
        role: roles[i],
        isDefault: true,
      }),
    );
    await em.flush();
    const roleIds = roles.map((r) => r.id);
    const userIds = users.map((u) => u.id);

    const wfId = await workflow(chain.map((_, i) => ({ stepNo: i + 1, approverRole: ref(Role, roleIds[i]) })));
    const docId = await seedDoc({ workflowId: wfId, base: '500', createdBy: ids.creator });

    await routing.start(docId);
    let doc = await reload(docId);
    expect(doc.status).toBe(DocStatus.IN_APPROVAL);
    expect(doc.currentStepNo).toBe(1);

    for (let i = 0; i < chain.length; i++) {
      // Sequential ordering: a later step's holder cannot act while an earlier step is open.
      if (i + 1 < chain.length) {
        await expect(
          asUser(userIds[i + 1], ids.companyA, () => routing.act(docId, { action: ApproveAction.APPROVE })),
        ).rejects.toThrow();
      }
      await asUser(userIds[i], ids.companyA, () => routing.act(docId, { action: ApproveAction.APPROVE }));
      doc = await reload(docId);
      if (i + 1 < chain.length) {
        expect(doc.currentStepNo).toBe(i + 2); // advanced to the next step
        expect(doc.status).toBe(DocStatus.IN_APPROVAL);
      }
    }

    // Last approval flips APPROVED → post-action (no-op here) → COMPLETED, atomically.
    expect(doc.status).toBe(DocStatus.COMPLETED);
    expect(doc.approvedAt).toBeTruthy();

    // Exactly seven APPROVE entries, one per step, by the right approver in order.
    const logs = await orm.em.fork().find(ApprovalLog, { document: docId }, { filters: { company: false }, populate: ['approver'] });
    const approvals = logs.filter((l) => l.action === ApproveAction.APPROVE).sort((a, b) => a.stepNo - b.stepNo);
    expect(approvals.map((l) => l.stepNo)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(approvals.map((l) => l.approver.id)).toEqual(userIds);
  });

  // ---- 8.4 Delegation + no chaining -----------------------------------------

  it('routes to the delegate (logged) and does not chain', async () => {
    const em = orm.em.fork();
    em.create(ApprovalDelegation, { company: em.getReference(Company, ids.companyA), delegator: em.getReference(AppUser, ids.delegator), delegate: em.getReference(AppUser, ids.delegate), startDate: '2000-01-01', endDate: FAR, status: 'ACTIVE', createdAt: new Date() });
    em.create(ApprovalDelegation, { company: em.getReference(Company, ids.companyA), delegator: em.getReference(AppUser, ids.delegate), delegate: em.getReference(AppUser, ids.delegateChain), startDate: '2000-01-01', endDate: FAR, status: 'ACTIVE', createdAt: new Date() });
    await em.flush();

    const wfId = await workflow([{ stepNo: 1, approverUser: ref(AppUser, ids.delegator) }]);
    const docId = await seedDoc({ workflowId: wfId, base: '10', createdBy: ids.creator });
    await routing.start(docId);

    await expect(asUser(ids.delegateChain, ids.companyA, () => routing.act(docId, { action: ApproveAction.APPROVE }))).rejects.toThrow();

    await asUser(ids.delegate, ids.companyA, () => routing.act(docId, { action: ApproveAction.APPROVE }));
    const logs = await orm.em.fork().find(ApprovalLog, { document: docId }, { filters: { company: false }, populate: ['approver', 'delegatedFrom'] });
    const approve = logs.find((l) => l.action === ApproveAction.APPROVE)!;
    expect(approve.approver.id).toBe(ids.delegate);
    expect(approve.delegatedFrom?.id).toBe(ids.delegator);
  });

  // ---- 8.5 Self-approval blocked --------------------------------------------

  it('blocks the creator from approving their own document', async () => {
    const wfId = await workflow([{ stepNo: 1, approverUser: ref(AppUser, ids.creator) }]);
    const docId = await seedDoc({ workflowId: wfId, base: '10', createdBy: ids.creator });
    await routing.start(docId);
    await expect(asUser(ids.creator, ids.companyA, () => routing.act(docId, { action: ApproveAction.APPROVE }))).rejects.toThrow();
  });

  // An action the engine does not handle must not become history. `act()` writes its append-only
  // row before it interprets the action, so `ESCALATE` — which only the SLA sweep may write — used
  // to fall through the switch having already been recorded. The DTO refuses it at the edge
  // (act-dto-validation.spec.ts); this is the second layer, for a caller that bypasses the DTO.
  it('records nothing for an action it does not handle', async () => {
    const wfId = await workflow([{ stepNo: 1, approverUser: ref(AppUser, ids.r1) }]);
    const docId = await seedDoc({ workflowId: wfId, base: '10', createdBy: ids.creator });
    await routing.start(docId);

    await expect(
      asUser(ids.r1, ids.companyA, () =>
        routing.act(docId, { action: ApproveAction.ESCALATE as never }),
      ),
    ).rejects.toThrow();

    const em = orm.em.fork();
    expect(await em.count(ApprovalLog, { document: docId }, { filters: { company: false } })).toBe(0);
    const doc = await em.findOneOrFail(Document, { id: docId }, { filters: { company: false } });
    expect(doc.status).toBe(DocStatus.IN_APPROVAL);
    expect(doc.currentStepNo).toBe(1);
  });

  // ---- 8.6 Reject releases holds --------------------------------------------

  it('reject sets REJECTED and releases reserved budget', async () => {
    const wfId = await workflow([{ stepNo: 1, approverUser: ref(AppUser, ids.ua) }]);
    const docId = await seedDoc({ workflowId: wfId, base: '100', createdBy: ids.creator, cut: true }, (em, doc) => {
      em.create(DocumentLine, { document: doc, lineNo: 1, description: 'x', qty: '1', unitPrice: '100', lineAmount: '100', baseLineAmount: '100', budget: em.getReference(Budget, ids.bA1), receivedQty: '0', lineStatus: 'OPEN' });
      em.create(BudgetTxn, { budget: em.getReference(Budget, ids.bA1), document: doc, txnType: 'RESERVE' as any, amount: '100', txnDate: TODAY, createdAt: new Date() });
    });

    await routing.start(docId);
    await asUser(ids.ua, ids.companyA, () => routing.act(docId, { action: ApproveAction.REJECT }));
    expect((await reload(docId)).status).toBe(DocStatus.REJECTED);
    expect(Number(await budgetBalance.outstandingReserved(docId, ids.bA1))).toBe(0);
  });

  // ---- 8.7 Append-only audit -------------------------------------------------

  it('rejects updating an approval_log row', async () => {
    const wfId = await workflow([{ stepNo: 1, approverUser: ref(AppUser, ids.ua) }]);
    const docId = await seedDoc({ workflowId: wfId, base: '10', createdBy: ids.creator });
    const em = orm.em.fork();
    const log = em.create(ApprovalLog, { document: em.getReference(Document, docId), stepNo: 1, approver: em.getReference(AppUser, ids.ua), action: ApproveAction.APPROVE, actedAt: new Date() });
    await em.flush();
    log.remark = 'tampered';
    await expect(em.flush()).rejects.toThrow(/append-only/i);
  });

  // ---- 8.8 Post-action settles ----------------------------------------------

  it('runs CUT_BUDGET post-action on full approval and completes', async () => {
    const wfId = await workflow([{ stepNo: 1, approverUser: ref(AppUser, ids.ua) }]);
    const docId = await seedDoc({ workflowId: wfId, base: '100', createdBy: ids.creator, cut: true }, (em, doc) => {
      em.create(DocumentLine, { document: doc, lineNo: 1, description: 'x', qty: '1', unitPrice: '100', lineAmount: '100', baseLineAmount: '100', budget: em.getReference(Budget, ids.bA1), receivedQty: '0', lineStatus: 'OPEN' });
      em.create(BudgetTxn, { budget: em.getReference(Budget, ids.bA1), document: doc, txnType: 'RESERVE' as any, amount: '100', txnDate: TODAY, createdAt: new Date() });
    });

    await routing.start(docId);
    await asUser(ids.ua, ids.companyA, () => routing.act(docId, { action: ApproveAction.APPROVE }));

    expect((await reload(docId)).status).toBe(DocStatus.COMPLETED);
    const txns = await orm.em.fork().find(BudgetTxn, { document: docId }, { filters: { company: false } });
    expect(txns.some((t) => t.txnType === ('ACTUAL' as any) && Number(t.amount) === 100)).toBe(true);
    expect(Number(await budgetBalance.outstandingReserved(docId, ids.bA1))).toBe(0);
  });

  // ---- 8.9 SLA working-hour due time ----------------------------------------

  it('computes a working-hour SLA due time that skips weekends and holidays', async () => {
    const base = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
    const friday = new Date(base);
    while (friday.getUTCDay() !== 5) friday.setUTCDate(friday.getUTCDate() + 1);
    const monday = new Date(friday);
    monday.setUTCDate(monday.getUTCDate() + 3);
    const em = orm.em.fork();
    em.create(HolidayCalendar, { company: em.getReference(Company, ids.companyA), holidayDate: monday.toISOString().slice(0, 10), name: 'Holiday' });
    await em.flush();

    const due = await sla.stepDueAt(friday, 24, ids.companyA);
    expect(due.getUTCDay()).toBe(2); // Tuesday — weekend + Monday holiday skipped
  });

  // ---- 8.10 Position-level step gating --------------------------------------

  it('includes a job-level-restricted step for a MANAGER and skips it for STAFF', async () => {
    // Two requesters with employee records carrying a job level.
    const em = orm.em.fork();
    const mgr = em.create(AppUser, { username: `mgr-${seq}`, email: `mgr-${seq}@x`, status: 'ACTIVE' });
    const stf = em.create(AppUser, { username: `stf-${seq}`, email: `stf-${seq}@x`, status: 'ACTIVE' });
    seq++;
    em.create(Employee, { company: em.getReference(Company, ids.companyA), department: em.getReference(Department, ids.deptA), user: mgr, empCode: `E-${seq++}`, fullName: 'Mgr', jobLevel: 'MANAGER', status: 'ACTIVE' });
    em.create(Employee, { company: em.getReference(Company, ids.companyA), department: em.getReference(Department, ids.deptA), user: stf, empCode: `E-${seq++}`, fullName: 'Stf', jobLevel: 'STAFF', status: 'ACTIVE' });
    await em.flush();

    // Step 2 only engages for MANAGER requesters.
    const wfId = await workflow([
      { stepNo: 1, approverUser: ref(AppUser, ids.ua) },
      { stepNo: 2, approverUser: ref(AppUser, ids.ua2), conditionJson: JSON.stringify({ jobLevels: ['MANAGER'] }) },
    ]);

    const mgrDoc = await seedDoc({ workflowId: wfId, base: '10', createdBy: mgr.id });
    await routing.start(mgrDoc);
    await asUser(ids.ua, ids.companyA, () => routing.act(mgrDoc, { action: ApproveAction.APPROVE }));
    expect((await reload(mgrDoc)).currentStepNo).toBe(2); // step 2 included for a manager

    const stfDoc = await seedDoc({ workflowId: wfId, base: '10', createdBy: stf.id });
    await routing.start(stfDoc);
    await asUser(ids.ua, ids.companyA, () => routing.act(stfDoc, { action: ApproveAction.APPROVE }));
    expect((await reload(stfDoc)).status).toBe(DocStatus.COMPLETED); // step 2 skipped for staff
  });

  // ---- 8.11 SLA escalation ---------------------------------------------------

  const PAST = new Date(Date.UTC(2025, 0, 6, 12, 0, 0)); // a Monday well in the past → overdue now

  // Escalation changes WHO may act. It used to change WHETHER: `current_step_no` moved past the
  // overdue step and the approval it required was performed by nobody.
  it('escalates an overdue step to its target WITHOUT moving the document past it', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: ref(AppUser, ids.ua), slaHours: 1, escalateToUser: ref(AppUser, ids.ua2) },
      { stepNo: 2, approverUser: ref(AppUser, ids.r1) },
    ]);
    const docId = await seedDoc({ workflowId: wfId, base: '10', createdBy: ids.creator }, (_em, doc) => {
      doc.submittedAt = PAST;
    });
    await routing.start(docId);

    const result = await sla.escalateOverdue(docId);
    expect(result?.stepNo).toBe(1);
    expect(result?.escalatedTo).toBe(ids.ua2);
    // The document has NOT moved: step 1's approval still has to happen.
    expect((await reload(docId)).currentStepNo).toBe(1);

    const logs = await orm.em.fork().find(ApprovalLog, { document: docId }, { filters: { company: false }, populate: ['approver'] });
    const esc = logs.find((l) => l.action === ApproveAction.ESCALATE);
    expect(esc).toBeTruthy();
    expect(esc!.stepNo).toBe(1);
    expect(esc!.approver.id).toBe(ids.ua); // logged "from" the overdue principal
    expect(esc!.remark).toContain(ids.ua2); // ...and "to" the target
  });

  it('lets the escalation target act on the step it was given', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: ref(AppUser, ids.ua), slaHours: 1, escalateToUser: ref(AppUser, ids.ua2) },
      { stepNo: 2, approverUser: ref(AppUser, ids.r1) },
    ]);
    const docId = await seedDoc({ workflowId: wfId, base: '10', createdBy: ids.creator }, (_em, doc) => {
      doc.submittedAt = PAST;
    });
    await routing.start(docId);
    await sla.escalateOverdue(docId);

    await asUser(ids.ua2, ids.companyA, () => routing.act(docId, { action: ApproveAction.APPROVE }));
    expect((await reload(docId)).currentStepNo).toBe(2);
  });

  it('chases a step that names no escalation target, and writes no ESCALATE row', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: ref(AppUser, ids.ua), slaHours: 1 },
      { stepNo: 2, approverUser: ref(AppUser, ids.ua2) },
    ]);
    const docId = await seedDoc({ workflowId: wfId, base: '10', createdBy: ids.creator }, (_em, doc) => {
      doc.submittedAt = PAST;
    });
    await routing.start(docId);

    expect(await sla.escalateOverdue(docId)).toBeNull();
    expect((await reload(docId)).currentStepNo).toBe(1);
    const logs = await orm.em.fork().find(ApprovalLog, { document: docId }, { filters: { company: false } });
    expect(logs.filter((l) => l.action === ApproveAction.ESCALATE)).toHaveLength(0);
  });

  // One escalation target cannot stand in for a committee, and no rule says which of the recorded
  // actors their approval would discharge.
  it('never reassigns a PARALLEL_ALL step, whatever it names', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverRole: ref(Role, ids.role), approveMode: 'PARALLEL_ALL', slaHours: 1, escalateToUser: ref(AppUser, ids.ua2) },
    ]);
    const docId = await seedDoc({ workflowId: wfId, base: '10', createdBy: ids.creator }, (_em, doc) => {
      doc.submittedAt = PAST;
    });
    await routing.start(docId);

    expect(await sla.escalateOverdue(docId)).toBeNull();
    expect((await reload(docId)).currentStepNo).toBe(1);
  });

  it('escalates a step once however many times the sweep runs', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: ref(AppUser, ids.ua), slaHours: 1, escalateToUser: ref(AppUser, ids.ua2) },
      { stepNo: 2, approverUser: ref(AppUser, ids.r1) },
    ]);
    const docId = await seedDoc({ workflowId: wfId, base: '10', createdBy: ids.creator }, (_em, doc) => {
      doc.submittedAt = PAST;
    });
    await routing.start(docId);

    expect(await sla.escalateOverdue(docId)).not.toBeNull();
    expect(await sla.escalateOverdue(docId)).toBeNull();
    const logs = await orm.em.fork().find(ApprovalLog, { document: docId }, { filters: { company: false } });
    expect(logs.filter((l) => l.action === ApproveAction.ESCALATE)).toHaveLength(1);
  });

  it('does not make the creator an approver by escalating to them', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: ref(AppUser, ids.ua), slaHours: 1, escalateToUser: ref(AppUser, ids.creator) },
      { stepNo: 2, approverUser: ref(AppUser, ids.ua2) },
    ]);
    const docId = await seedDoc({ workflowId: wfId, base: '10', createdBy: ids.creator }, (_em, doc) => {
      doc.submittedAt = PAST;
    });
    await routing.start(docId);

    const result = await sla.escalateOverdue(docId);
    expect(result).toBeNull();
    expect((await reload(docId)).currentStepNo).toBe(1);
  });

  it('suppresses escalation when the overdue step has an active delegate', async () => {
    const em = orm.em.fork();
    em.create(ApprovalDelegation, { company: em.getReference(Company, ids.companyA), delegator: em.getReference(AppUser, ids.delegator), delegate: em.getReference(AppUser, ids.delegate), startDate: '2000-01-01', endDate: FAR, status: 'ACTIVE', createdAt: new Date() });
    await em.flush();

    const wfId = await workflow([
      { stepNo: 1, approverUser: ref(AppUser, ids.delegator), slaHours: 1 },
      { stepNo: 2, approverUser: ref(AppUser, ids.ua2) },
    ]);
    const docId = await seedDoc({ workflowId: wfId, base: '10', createdBy: ids.creator }, (_em, doc) => {
      doc.submittedAt = PAST;
    });
    await routing.start(docId);

    const result = await sla.escalateOverdue(docId);
    expect(result).toBeNull();
    expect((await reload(docId)).currentStepNo).toBe(1);
  });

  it('serializes a concurrent approve and escalation on the same step (no double-handling)', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: ref(AppUser, ids.ua), slaHours: 1, escalateToUser: ref(AppUser, ids.r1) },
      { stepNo: 2, approverUser: ref(AppUser, ids.ua2) },
    ]);
    const docId = await seedDoc({ workflowId: wfId, base: '10', createdBy: ids.creator }, (_em, doc) => {
      doc.submittedAt = PAST;
    });
    await routing.start(docId);

    // Each unit of work on its own fork — mirrors true concurrent requests.
    //
    // The approving service needs a REAL post-action: with a null one `act()` threw before it could
    // advance anything, and this assertion used to be satisfied by the escalation moving the step
    // instead. Escalation no longer moves anything, so the approval has to actually work for this
    // test to be about serialisation rather than about which failure won.
    const emAct = orm.em.fork();
    const routingC = new ApprovalRoutingService(
      emAct,
      new ApproverResolverService(emAct),
      new PostActionService(new BudgetLedgerService(emAct, new BudgetBalanceService(emAct), new BudgetCoverageService(emAct)), emAct),
      null as any,
      new DocumentRouteService(emAct, new WorkflowStepResolver(emAct), new ApproverResolverService(emAct)),
    );
    const emEsc = orm.em.fork();
    const slaC = new SlaService(
      emEsc,
      new WorkingTimeService(new CompanyScopeService(emEsc)),
      new ApproverResolverService(emEsc),
      new DocumentRouteService(emEsc, new WorkflowStepResolver(emEsc), new ApproverResolverService(emEsc)),
    );

    await Promise.allSettled([
      asUser(ids.ua, ids.companyA, () => routingC.act(docId, { action: ApproveAction.APPROVE })),
      slaC.escalateOverdue(docId),
    ]);

    // They serialise on the document row: the approval advances to step 2 exactly once, and an
    // escalation that lands either side of it adds an actor rather than skipping a step, so the
    // document can never end up past step 2.
    expect((await reload(docId)).currentStepNo).toBe(2);
  });

  // ---- 8.12 CREATE_SUCCESSOR post-action -------------------------------------------

  function makePostAction() {
    return new PostActionService(new BudgetLedgerService(orm.em, budgetBalance, new BudgetCoverageService(orm.em)), orm.em);
  }

  /** The sweeper that fulfils the obligations the post-action records. */
  function makeSweeper() {
    const scope = new CompanyScopeService(orm.em);
    const documentService = new DocumentService(
      orm.em, scope, new DeptDocTypeService(orm.em), new NumberingService(orm.em),
      new ItemService(orm.em, scope, new ScopeService(), new AccountService(orm.em, scope)),
      new BudgetService(orm.em, new AccountService(orm.em, scope), new BudgetBalanceService(orm.em)),
      new FiscalYearService(scope),
    );
    return new SuccessorSweeper(orm.em, documentService);
  }

  /**
   * Approval's half: run the post-action in a transaction, as ApprovalRoutingService does. It
   * records pending_successor rows; it does NOT create the successor — the sweeper does, after.
   */
  async function recordObligations(documentId: string): Promise<void> {
    const postAction = makePostAction();
    await orm.em.fork().transactional(async (tem) => {
      const doc = await tem.findOneOrFail(
        Document,
        { id: documentId },
        { filters: { company: false }, populate: ['documentType', 'company', 'department'] },
      );
      await postAction.run(doc, tem);
    });
  }

  async function seedCompleted(typeId: string, tmplId: string): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `C-${seq++}`,
      company: em.getReference(Company, ids.companyA),
      department: em.getReference(Department, ids.deptA),
      documentType: em.getReference(DocumentType, typeId),
      formTemplate: em.getReference(FormTemplate, tmplId),
      workflow: em.getReference(Workflow, ids.wfCla),
      currentStepNo: 1,
      createdBy: em.getReference(AppUser, ids.creator),
      exchangeRate: '1',
      status: DocStatus.COMPLETED,
      submittedAt: new Date(),
      approvedAt: new Date(),
      createdAt: new Date(),
    });
    await em.flush();
    return doc.id;
  }

  it('CREATE_SUCCESSOR creates a DRAFT for each auto_create pairing, and not for manual ones', async () => {
    const advId = await seedCompleted(ids.advType, ids.advTmpl);

    await recordObligations(advId);
    await makeSweeper().scanPending();

    const created = await orm.em.fork().find(
      Document,
      { refDocument: advId },
      { filters: { company: false }, populate: ['documentType'] },
    );
    // Both auto_create successors are created; the auto_create=false MANUAL_SUCC is not.
    expect(created.map((d) => d.documentType.code).sort()).toEqual(['CLEAR_ADVANCE', 'CLEAR_ADVANCE2']);
    expect(created.every((d) => d.status === DocStatus.DRAFT)).toBe(true);
  });

  it('CREATE_SUCCESSOR records the obligation without creating the successor', async () => {
    const advId = await seedCompleted(ids.advType, ids.advTmpl);

    await recordObligations(advId);

    // The approval's own transaction owes the successors but must not have created them: createFrom
    // needs the source COMPLETED, which it only is once that transaction commits.
    const rows = await orm.em
      .fork()
      .find(PendingSuccessor, { sourceDocument: advId }, { filters: { company: false } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === PendingSuccessorStatus.PENDING)).toBe(true);
    const created = await orm.em.fork().findOne(Document, { refDocument: advId }, { filters: { company: false } });
    expect(created).toBeNull();
  });

  it('a swept obligation is marked DONE and is not fulfilled twice', async () => {
    const advId = await seedCompleted(ids.advType, ids.advTmpl);
    await recordObligations(advId);

    const sweeper = makeSweeper();
    await sweeper.scanPending();
    // A second sweep must not create the successors again — the DONE rows are no longer claimable.
    await sweeper.scanPending();

    // Assert on this document's own rows: scanPending drains the whole queue, so its count also
    // reflects obligations other tests in this file left behind.
    const rows = await orm.em
      .fork()
      .find(PendingSuccessor, { sourceDocument: advId }, { filters: { company: false } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === PendingSuccessorStatus.DONE)).toBe(true);
    const created = await orm.em.fork().find(Document, { refDocument: advId }, { filters: { company: false } });
    expect(created).toHaveLength(2);
  });

  it('the successor belongs to the source requester, not whoever approved', async () => {
    const advId = await seedCompleted(ids.advType, ids.advTmpl);
    await recordObligations(advId);
    await makeSweeper().scanPending();

    const created = await orm.em
      .fork()
      .find(Document, { refDocument: advId }, { filters: { company: false }, populate: ['createdBy'] });
    // The old post-commit path ran inside the approver's request, so the successor inherited the
    // approver — silently barring them from the successor's own approval under invariant 8.
    expect(created.every((d) => d.createdBy?.id === ids.creator)).toBe(true);
  });

  it('CREATE_SUCCESSOR is a no-op when no auto_create pairing resolves', async () => {
    const orphanId = await seedCompleted(ids.orphanType, ids.orphTmpl);

    await recordObligations(orphanId);
    await makeSweeper().scanPending();

    const rows = await orm.em
      .fork()
      .find(PendingSuccessor, { sourceDocument: orphanId }, { filters: { company: false } });
    expect(rows).toHaveLength(0);
    const created = await orm.em.fork().findOne(Document, { refDocument: orphanId }, { filters: { company: false } });
    expect(created).toBeNull();
  });

  // ---- Signature snapshot on APPROVE ----------------------------------------

  /** Give a user a current signature; returns the signature id. */
  async function giveSignature(userId: string, filePath: string): Promise<string> {
    const em = orm.em.fork();
    const sig = em.create(UserSignature, {
      user: em.getReference(AppUser, userId),
      filePath,
      mimeType: 'image/png',
      uploadedAt: new Date(),
    });
    em.persist(sig);
    await em.flush();
    const user = await em.findOneOrFail(AppUser, { id: userId });
    user.currentSignatureId = sig.id;
    await em.flush();
    return sig.id;
  }

  const logFor = (docId: string) =>
    orm.em.fork().findOneOrFail(
      ApprovalLog,
      { document: docId },
      { filters: { company: false }, populate: ['signature'] },
    );

  it('APPROVE stamps the approver current signature onto the append-only log', async () => {
    const sigId = await giveSignature(ids.ua, 'signatures/ua/approve.png');
    const wfId = await workflow([{ stepNo: 1, approverUser: ref(AppUser, ids.ua) }]);
    const docId = await seedDoc({ workflowId: wfId, base: '10', createdBy: ids.creator });
    await routing.start(docId);
    await asUser(ids.ua, ids.companyA, () => routing.act(docId, { action: ApproveAction.APPROVE }));

    const log = await logFor(docId);
    expect(log.action).toBe(ApproveAction.APPROVE);
    expect(log.signature?.id).toBe(sigId);
  });

  it('APPROVE without a signature on file still succeeds and records a null signature', async () => {
    // ua2 has no current signature.
    const wfId = await workflow([{ stepNo: 1, approverUser: ref(AppUser, ids.ua2) }]);
    const docId = await seedDoc({ workflowId: wfId, base: '10', createdBy: ids.creator });
    await routing.start(docId);
    await asUser(ids.ua2, ids.companyA, () => routing.act(docId, { action: ApproveAction.APPROVE }));

    expect((await reload(docId)).status).toBe(DocStatus.COMPLETED);
    expect((await logFor(docId)).signature).toBeNull();
  });

  it('REJECT does not stamp a signature even when the actor has one', async () => {
    await giveSignature(ids.ua, 'signatures/ua/reject.png');
    const wfId = await workflow([{ stepNo: 1, approverUser: ref(AppUser, ids.ua) }]);
    const docId = await seedDoc({ workflowId: wfId, base: '10', createdBy: ids.creator });
    await routing.start(docId);
    await asUser(ids.ua, ids.companyA, () => routing.act(docId, { action: ApproveAction.REJECT }));

    const log = await logFor(docId);
    expect(log.action).toBe(ApproveAction.REJECT);
    expect(log.signature).toBeNull();
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[approval-workflow] no database reachable — skipping DB-backed spec');
}

import { EventEmitter2 } from '@nestjs/event-emitter';
import { attachCoverage } from '../../test/budget-fixture';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import {
  AccountRoleType, ApproveAction, BudgetTxnType, ControlPolicy, DocCategory, DocStatus, GlPostingStatus, Scope,
} from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Account } from '../accounting/accounting.entities';
import { AccountService } from '../accounting/account.service';
import { AccountingPeriod } from '../accounting/period/accounting-period.entities';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
import { DocumentRouteService } from '../approval/document-route.service';
import { ApproverResolverService } from '../approval/approver-resolver.service';
import { ApprovalRoutingService } from '../approval/approval-routing.service';
import { PostActionService } from '../approval/post-action.service';
import { WorkflowStepResolver } from '../approval/workflow-step.resolver';
import { Workflow, WorkflowStep } from '../approval/approval.entities';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { BudgetService } from '../budget/budget.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { Currency } from '../currency/currency.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { DeptDocTypeService } from '../document/dept-doc-type.service';
import { DocumentService } from '../document/document.service';
import { DocumentTypeService } from '../document/document-type.service';
import { DocumentSubmitService } from '../document/document-submit.service';
import { NumberingService } from '../document/numbering.service';
import {
  DeptDocType, Document, DocumentCategory, DocumentType, FormTemplate,
} from '../document/document.entities';
import { ItemService } from '../master-data/item.service';
import { VendorService } from '../master-data/vendor.service';
import { Vendor } from '../master-data/master-data.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { AppUser, Permission, Role, RolePermission, UserCompanyRole } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { AccountRoleService } from './account-role.service';
import { AccountRole, JournalEntry, JournalLine } from './gl.entities';
import { GlPostingAttempt } from './gl-posting.entities';
import { GlPostingService } from './gl-posting.service';
import { GlPostingListener } from './gl-posting.listener';
import type { MikroORM } from '@mikro-orm/postgresql';

// Fixtures write budget rows directly; `budget_txn.txn_date` is the day of the event and is
// not nullable, so a fixture must state one just as the ledger service does.
const TODAY = new Date().toISOString().slice(0, 10);

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

const G = { userId: '', approverId: '' };

/**
 * Recognising a compensation at approval rather than at payment.
 *
 * The GL posts when a disbursement settles, and a claim never settles one — its payee is a
 * customer, so the money leaves outside this system. Without an accrual the budget report would
 * show the year's claims while the profit-and-loss showed nothing.
 */
describe.skipIf(!hasDb)('accrual on approval (DB-backed)', () => {
  let orm: MikroORM;
  let posting: GlPostingService;
  let routing: ApprovalRoutingService;
  let documents: DocumentService;
  let submitSvc: DocumentSubmitService;
  let types: DocumentTypeService;
  let emitter: EventEmitter2;
  let posted: Promise<void>;

  const ids = {
    companyA: '', deptA: '', dtAccrue: '', dtPlain: '', budget: '', budget2: '',
    expense: '', expense2: '', payable: '', apAccount: '', vendor: '', wfA: '',
    companyB: '', deptB: '', dtAccrueB: '', budgetB: '', expenseB: '',
  };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const y = new Date().getUTCFullYear();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });

    const user = em.create(AppUser, { username: 'req', email: 'r@x', status: 'ACTIVE' });
    const approver = em.create(AppUser, { username: 'app', email: 'a@x', status: 'ACTIVE' });

    const mk = (code: string) => {
      const company = em.create(Company, { code, nameTh: code, taxId: code, branchCode: '00000', baseCurrency: thb, isActive: true });
      const dept = em.create(Department, { company, deptCode: `D${code}`, name: `D${code}`, isActive: true });
      const fy = em.create(FiscalYear, { company, year: y, startDate: `${y}-01-01`, endDate: `${y}-12-31`, status: 'OPEN' });
      const wf = em.create(Workflow, { company, name: `WF${code}`, isActive: true });
      for (const c of [DocCategory.FINANCE, DocCategory.ADMIN]) {
        em.create(DocumentCategory, { company, code: c, name: c, isActive: true });
      }
      const expense = em.create(Account, { company, code: '5210', name: 'Claim expense', accountType: 'EXPENSE', isPostable: true, isActive: true } as never);
      const budget = em.create(Budget, {
        fiscalYear: fy, department: dept, glAccount: '5210', account: expense, budgetName: 'Claims',
        amountTotal: '1000000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE',
      } as never);
      attachCoverage(em, company, budget);
      return { company, dept, fy, wf, expense, budget };
    };

    const a = mk('A');
    const b = mk('B');

    // A second budget in company A, so a document cutting two budgets can be proved.
    const expense2 = em.create(Account, { company: a.company, code: '5300', name: 'Other expense', accountType: 'EXPENSE', isPostable: true, isActive: true } as never);
    const budget2 = em.create(Budget, {
      fiscalYear: a.fy, department: a.dept, glAccount: '5300', account: expense2, budgetName: 'Other',
      amountTotal: '1000000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE',
    } as never);
    attachCoverage(em, a.company, budget2);

    // Only company A maps CLAIM_PAYABLE. Company B deliberately does not, which is scenario 5.4.
    const payable = em.create(Account, { company: a.company, code: '2130', name: 'Claim payable', accountType: 'LIABILITY', isPostable: true, isActive: true } as never);
    em.create(AccountRole, { company: a.company, role: AccountRoleType.CLAIM_PAYABLE, account: payable } as never);

    // Trade payable + a vendor, so a purchase can be told apart from a compensation. Company B
    // deliberately maps neither, which keeps the "no payable mapped" case above working.
    const apAccount = em.create(Account, { company: a.company, code: '2000', name: 'Accounts payable', accountType: 'LIABILITY', isPostable: true, isActive: true } as never);
    em.create(AccountRole, { company: a.company, role: AccountRoleType.ACCOUNTS_PAYABLE, account: apAccount } as never);
    const vendor = em.create(Vendor, { vendorCode: 'V-AP-1', name: 'Supplier Co', paymentTermDays: 30, isActive: true } as never);

    const mkType = (company: Company, dept: Department, wf: Workflow, code: string, accrues: boolean) => {
      const dt = em.create(DocumentType, {
        company, code, name: code, category: DocCategory.FINANCE,
        requiresBudget: true, requiresQuota: false, defaultGlAccount: '5210',
        postAction: 'CUT_BUDGET', accruesOnApproval: accrues, isActive: true,
      } as never);
      const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
      em.create(DeptDocType, { department: dept, documentType: dt, formTemplate: tmpl, workflow: wf, isActive: true });
      return dt;
    };
    const dtAccrue = mkType(a.company, a.dept, a.wf, 'CLAIM', true);
    const dtPlain = mkType(a.company, a.dept, a.wf, 'MEMO', false);
    const dtAccrueB = mkType(b.company, b.dept, b.wf, 'CLAIM', true);

    // One approval step covering every amount, so nothing falls through with a budget reserved.
    const role = em.create(Role, { company: a.company, code: 'APPR', name: 'Approver', isActive: true } as never);
    em.create(WorkflowStep, { workflow: a.wf, stepNo: 1, stepName: 'Head', approverRole: role, approveMode: 'SEQUENTIAL', showSignatureOnPdf: true } as never);
    const perm = em.create(Permission, { code: 'DOC_APPROVE', name: 'DOC_APPROVE', module: 'DOC', isActive: true });
    em.create(RolePermission, { role, permission: perm, scope: Scope.COMPANY } as never);
    em.create(UserCompanyRole, { user: approver, company: a.company, department: a.dept, role, isDefault: true } as never);

    await em.flush();
    G.userId = user.id;
    G.approverId = approver.id;
    Object.assign(ids, {
      companyA: a.company.id, deptA: a.dept.id, wfA: a.wf.id,
      dtAccrue: dtAccrue.id, dtPlain: dtPlain.id,
      budget: a.budget.id, budget2: budget2.id, expense: a.expense.id, expense2: expense2.id,
      payable: payable.id, apAccount: apAccount.id, vendor: vendor.id,
      companyB: b.company.id, deptB: b.dept.id, dtAccrueB: dtAccrueB.id,
      budgetB: b.budget.id, expenseB: b.expense.id,
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
    const accounts = new AccountService(orm.em, scope);
    posting = new GlPostingService(orm.em, new AccountRoleService(orm.em), accounts, new PeriodGuardService());
    types = new DocumentTypeService(orm.em);

    const budgetLedger = new BudgetLedgerService(orm.em, new BudgetBalanceService(orm.em), new BudgetCoverageService(orm.em));
    const items = new ItemService(orm.em, scope, new ScopeService(), accounts);
    submitSvc = new DocumentSubmitService(
      orm.em, new ExchangeRateService(orm.em), new FiscalYearService(scope),
      new VendorService(orm.em, scope, new ScopeService()), items, budgetLedger,
      new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em)),
    );
    documents = new DocumentService(
      orm.em, scope, new DeptDocTypeService(orm.em), new NumberingService(orm.em), items,
      new BudgetService(orm.em, accounts, new BudgetBalanceService(orm.em)), new FiscalYearService(scope),
    );

    // The real emitter, wired by hand: @OnEvent only subscribes under Nest's EventEmitterModule.
    // This is what makes the ordering real — the accrual runs off the event the router emits after
    // its transaction commits, not off a call the test makes itself.
    emitter = new EventEmitter2();
    const listener = new GlPostingListener(posting);
    posted = Promise.resolve();
    emitter.on('approval.outcome', (e: { documentId: string; status: string }) => {
      posted = listener.onApprovalOutcome(e);
    });
    routing = new ApprovalRoutingService(
      orm.em,
      new ApproverResolverService(orm.em),
      new PostActionService(budgetLedger, orm.em, documents),
      submitSvc,
      new DocumentRouteService(orm.em, new WorkflowStepResolver(orm.em), new ApproverResolverService(orm.em)),
      emitter,
    );
  });

  const asReq = <T>(companyId: string, departmentId: string, fn: () => Promise<T>) =>
    RequestContext.run({ userId: G.userId, companyId, departmentId, grants: [] }, fn);
  const asApprover = <T>(companyId: string, departmentId: string, fn: () => Promise<T>) =>
    RequestContext.run(
      { userId: G.approverId, companyId, departmentId, grants: [{ code: 'DOC_APPROVE', scope: Scope.COMPANY }] as never },
      fn,
    );

  const entryFor = (documentId: string) =>
    orm.em.fork().findOne(
      JournalEntry,
      { sourceType: 'APPROVAL_ACCRUAL', sourceId: documentId },
      FILTER_OFF,
    );
  const linesOf = (entryId: string) =>
    orm.em.fork().find(JournalLine, { journalEntry: entryId }, { ...FILTER_OFF, populate: ['account'] });

  /** Create → submit → approve, driving the real router so the accrual runs off its event. */
  async function approveThrough(documentTypeId: string, amount: string, glAccount = '5210') {
    const doc = await asReq(ids.companyA, ids.deptA, () =>
      documents.createDraft({
        documentTypeId,
        lines: [{ lineNo: 1, description: 'ค่าชดเชย', qty: '1', unitPrice: amount, lineAmount: amount, glAccount }],
      } as never),
    );
    await asReq(ids.companyA, ids.deptA, () => submitSvc.submit(doc.id));
    // In the running app `ApprovalSubmittedListener` does this off `document.submitted`; here the
    // routing is started explicitly so the spec drives the same SUBMITTED → IN_APPROVAL step.
    await routing.start(doc.id);
    await asApprover(ids.companyA, ids.deptA, () =>
      routing.act(doc.id, { action: ApproveAction.APPROVE } as never),
    );
    await posted; // the listener the emitter kicked off
    return doc.id;
  }

  it('recognises the expense and the liability when a claim is fully approved', async () => {
    const docId = await approveThrough(ids.dtAccrue, '4500');

    const doc = await orm.em.fork().findOneOrFail(Document, { id: docId }, FILTER_OFF);
    expect(doc.status).toBe(DocStatus.COMPLETED);

    const entry = await entryFor(docId);
    expect(entry).not.toBeNull();
    const lines = await linesOf(entry!.id);
    const debit = lines.find((l) => l.account.id === ids.expense);
    const credit = lines.find((l) => l.account.id === ids.payable);
    expect(debit?.debit).toBe('4500.00');
    expect(credit?.credit).toBe('4500.00');
    // Balanced-entry invariant.
    const sum = (k: 'debit' | 'credit') => lines.reduce((s, l) => s + Number(l[k]), 0);
    expect(sum('debit')).toBe(sum('credit'));
  });

  it('finds the ACTUAL rows the approval wrote — the event fires after the commit', async () => {
    // The accrual reads budget_txn ACTUAL rows written by the post-action inside the approval
    // transaction. If the outcome event were ever emitted before that commit, this entry would be
    // missing and the books would be quietly short. Pinned here so a reordering breaks a test.
    const docId = await approveThrough(ids.dtAccrue, '1200');
    const actuals = await orm.em.fork().count(BudgetTxn, { document: docId, txnType: BudgetTxnType.ACTUAL }, FILTER_OFF);
    expect(actuals).toBeGreaterThan(0);
    expect(await entryFor(docId)).not.toBeNull();
  });

  it('posts nothing at approval for a type that does not accrue', async () => {
    const docId = await approveThrough(ids.dtPlain, '900');
    expect(await entryFor(docId)).toBeNull();
  });

  it('posts once when the outcome is delivered twice', async () => {
    const docId = await approveThrough(ids.dtAccrue, '700');
    await posting.postAccrualForApproval(docId);

    const entries = await orm.em.fork().find(
      JournalEntry, { sourceType: 'APPROVAL_ACCRUAL', sourceId: docId }, FILTER_OFF,
    );
    expect(entries).toHaveLength(1);
  });

  it('carries one debit line per expense account and one credit for the sum', async () => {
    // Arranged directly: two ACTUAL rows against two budgets, the shape a multi-budget document
    // produces, without needing a second document type to reach both.
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `MULTI-${Date.now()}`, company: em.getReference(Company, ids.companyA),
      department: em.getReference(Department, ids.deptA),
      documentType: em.getReference(DocumentType, ids.dtAccrue),
      formTemplate: em.getReference(FormTemplate, (await em.findOneOrFail(FormTemplate, { documentType: ids.dtAccrue }, FILTER_OFF)).id),
      workflow: em.getReference(Workflow, ids.wfA),
      createdBy: em.getReference(AppUser, G.userId), status: DocStatus.COMPLETED,
      exchangeRate: '1', approvedAt: new Date(), createdAt: new Date(),
    } as never);
    await em.flush();
    em.create(BudgetTxn, { budget: em.getReference(Budget, ids.budget), document: doc, txnType: BudgetTxnType.ACTUAL, txnDate: TODAY, amount: '300.00', createdAt: new Date() } as never);
    em.create(BudgetTxn, { budget: em.getReference(Budget, ids.budget2), document: doc, txnType: BudgetTxnType.ACTUAL, txnDate: TODAY, amount: '200.00', createdAt: new Date() } as never);
    await em.flush();

    await posting.postAccrualForApproval(doc.id);

    const entry = await entryFor(doc.id);
    const lines = await linesOf(entry!.id);
    expect(lines).toHaveLength(3);
    expect(lines.find((l) => l.account.id === ids.expense)?.debit).toBe('300.00');
    expect(lines.find((l) => l.account.id === ids.expense2)?.debit).toBe('200.00');
    expect(lines.find((l) => l.account.id === ids.payable)?.credit).toBe('500.00');
  });

  // ── Trade payables ────────────────────────────────────────────────────────────────────────────

  /** A COMPLETED document of the accruing type, optionally with a vendor and a reference chain. */
  async function approved(opts: {
    vendor?: boolean;
    refDocumentId?: string;
    /** false = the document carries no ACTUAL of its own, as a chained settlement does not. */
    ownActual?: boolean;
    tag: string;
  }): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `${opts.tag}-${Date.now()}-${Math.round(performance.now() * 1000)}`,
      company: em.getReference(Company, ids.companyA),
      department: em.getReference(Department, ids.deptA),
      documentType: em.getReference(DocumentType, ids.dtAccrue),
      formTemplate: em.getReference(FormTemplate, (await em.findOneOrFail(FormTemplate, { documentType: ids.dtAccrue }, FILTER_OFF)).id),
      workflow: em.getReference(Workflow, ids.wfA),
      createdBy: em.getReference(AppUser, G.userId), status: DocStatus.COMPLETED,
      vendor: opts.vendor ? em.getReference(Vendor, ids.vendor) : undefined,
      refDocument: opts.refDocumentId ? em.getReference(Document, opts.refDocumentId) : undefined,
      exchangeRate: '1', approvedAt: new Date(), createdAt: new Date(),
    } as never);
    await em.flush();
    if (opts.ownActual !== false) {
      em.create(BudgetTxn, { budget: em.getReference(Budget, ids.budget), document: doc, txnType: BudgetTxnType.ACTUAL, txnDate: TODAY, amount: '4000.00', createdAt: new Date() } as never);
      await em.flush();
    }
    return doc.id;
  }

  it('credits ACCOUNTS_PAYABLE for a purchase and CLAIM_PAYABLE for a compensation', async () => {
    const purchase = await approved({ vendor: true, tag: 'AP' });
    const claim = await approved({ tag: 'CL' });

    await posting.postAccrualForApproval(purchase);
    await posting.postAccrualForApproval(claim);

    const apLines = await linesOf((await entryFor(purchase))!.id);
    expect(apLines.find((l) => l.account.id === ids.apAccount)?.credit).toBe('4000.00');
    // Derived from the document's own vendor, not from a second configuration flag.
    const clLines = await linesOf((await entryFor(claim))!.id);
    expect(clLines.find((l) => l.account.id === ids.payable)?.credit).toBe('4000.00');
  });

  it('accrues a CHAINED purchase from its ancestor cuts', async () => {
    // The failure this whole change turns on. `cutBudget` writes ACTUAL under the RESERVING
    // document, so a DISB reading only its own rows finds none, logs "Accrual skipped", and its
    // payment falls through to the old expense branch — quietly, consistently, and producing
    // exactly the cash-basis books the change set out to replace.
    const ancestor = await approved({ vendor: true, tag: 'AP-ANC' });
    const paid = await approved({ vendor: true, refDocumentId: ancestor, ownActual: false, tag: 'AP-CHAIN' });

    await posting.postAccrualForApproval(paid);

    const entry = await entryFor(paid);
    expect(entry).not.toBeNull();
    const lines = await linesOf(entry!.id);
    expect(lines.find((l) => l.account.id === ids.apAccount)?.credit).toBe('4000.00');
    expect(lines.find((l) => l.account.id === ids.expense)?.debit).toBe('4000.00');
  });

  it('leaves the approval standing when ACCOUNTS_PAYABLE is unmapped, and records the failure', async () => {
    // Same contract the claim path already has, for the role a purchase needs: the approval and its
    // budget cut stand, no entry is written, and the failure is a queryable undelivered posting
    // rather than only a log line.
    const em = orm.em.fork();
    await em.nativeDelete(AccountRole, { company: ids.companyA, role: AccountRoleType.ACCOUNTS_PAYABLE }, FILTER_OFF);
    const doc = await approved({ vendor: true, tag: 'AP-NOROLE' });

    await expect(posting.postAccrualForApproval(doc)).rejects.toThrow(/ACCOUNTS_PAYABLE/);
    expect(await entryFor(doc)).toBeNull();

    const row = await orm.em.fork().findOne(
      GlPostingAttempt,
      { sourceType: 'APPROVAL_ACCRUAL', sourceId: doc },
      FILTER_OFF,
    );
    expect(row?.status).toBe(GlPostingStatus.FAILED);
    expect(row?.lastError).toMatch(/ACCOUNTS_PAYABLE/);

    // Restore, so the cases after this one still have a payable to credit.
    const em2 = orm.em.fork();
    em2.create(AccountRole, {
      company: em2.getReference(Company, ids.companyA),
      role: AccountRoleType.ACCOUNTS_PAYABLE,
      account: em2.getReference(Account, ids.apAccount),
    } as never);
    await em2.flush();
  });

  it('posts nothing for a document that cut no budget', async () => {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `NOCUT-${Date.now()}`, company: em.getReference(Company, ids.companyA),
      department: em.getReference(Department, ids.deptA),
      documentType: em.getReference(DocumentType, ids.dtAccrue),
      formTemplate: em.getReference(FormTemplate, (await em.findOneOrFail(FormTemplate, { documentType: ids.dtAccrue }, FILTER_OFF)).id),
      workflow: em.getReference(Workflow, ids.wfA),
      createdBy: em.getReference(AppUser, G.userId), status: DocStatus.COMPLETED,
      exchangeRate: '1', approvedAt: new Date(), createdAt: new Date(),
    } as never);
    await em.flush();

    await posting.postAccrualForApproval(doc.id);
    expect(await entryFor(doc.id)).toBeNull();

    // Recorded as SKIPPED, not left silent: a terminal outcome is what keeps this document off the
    // undelivered-postings read instead of being offered as owed on every sweep.
    const row = await orm.em.fork().findOne(
      GlPostingAttempt,
      { sourceType: 'APPROVAL_ACCRUAL', sourceId: doc.id },
      FILTER_OFF,
    );
    expect(row?.status).toBe(GlPostingStatus.SKIPPED);
  });

  it('leaves the approval standing when the company has no CLAIM_PAYABLE mapped', async () => {
    // Company B maps no payable. The posting must fail, and the failure must not reach the
    // approval — which has already committed with its budget cut.
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `NOROLE-${Date.now()}`, company: em.getReference(Company, ids.companyB),
      department: em.getReference(Department, ids.deptB),
      documentType: em.getReference(DocumentType, ids.dtAccrueB),
      formTemplate: em.getReference(FormTemplate, (await em.findOneOrFail(FormTemplate, { documentType: ids.dtAccrueB }, FILTER_OFF)).id),
      workflow: em.getReference(Workflow, (await em.findOneOrFail(Workflow, { company: ids.companyB }, FILTER_OFF)).id),
      createdBy: em.getReference(AppUser, G.userId), status: DocStatus.COMPLETED,
      exchangeRate: '1', approvedAt: new Date(), createdAt: new Date(),
    } as never);
    await em.flush();
    em.create(BudgetTxn, { budget: em.getReference(Budget, ids.budgetB), document: doc, txnType: BudgetTxnType.ACTUAL, txnDate: TODAY, amount: '100.00', createdAt: new Date() } as never);
    await em.flush();

    // The listener swallows and logs; calling the service directly shows the failure it swallowed.
    await expect(posting.postAccrualForApproval(doc.id)).rejects.toThrow();
    await new GlPostingListener(posting).onApprovalOutcome({ documentId: doc.id, status: 'COMPLETED' });

    expect(await entryFor(doc.id)).toBeNull();

    // The failure is recorded, not merely logged — this is the accrual path's half of the contract
    // that a posting the ledger owes and could not deliver is a queryable state.
    const row = await orm.em.fork().findOne(
      GlPostingAttempt,
      { sourceType: 'APPROVAL_ACCRUAL', sourceId: doc.id },
      FILTER_OFF,
    );
    expect(row?.status).toBe(GlPostingStatus.FAILED);
    expect(row?.lastError).toMatch(/CLAIM_PAYABLE/);
    expect(row!.attempts).toBeGreaterThanOrEqual(1);
    const stored = await orm.em.fork().findOneOrFail(Document, { id: doc.id }, FILTER_OFF);
    expect(stored.status).toBe(DocStatus.COMPLETED);
    expect(await orm.em.fork().count(BudgetTxn, { document: doc.id }, FILTER_OFF)).toBe(1);
  });

  it('never resolves another company\'s payable mapping', async () => {
    // Company A maps CLAIM_PAYABLE; company B does not. B's posting must not borrow A's.
    const em = orm.em.fork();
    const mapped = await em.find(AccountRole, { role: AccountRoleType.CLAIM_PAYABLE }, FILTER_OFF);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].company.id).toBe(ids.companyA);
  });

  // ── Entry date ────────────────────────────────────────────────────────────────────────────────
  // These give company B a CLAIM_PAYABLE mapping so it can post, which is why they sit AFTER the
  // case above that asserts only company A maps one.

  /** COMPLETED document with one ACTUAL, approved at a chosen instant, in a chosen company. */
  async function approvedAt(
    company: string, dept: string, docType: string, budget: string, at: Date, tag: string,
    invoice?: { no: string; date: string },
  ): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `${tag}-${Date.now()}`, company: em.getReference(Company, company),
      department: em.getReference(Department, dept),
      documentType: em.getReference(DocumentType, docType),
      formTemplate: em.getReference(FormTemplate, (await em.findOneOrFail(FormTemplate, { documentType: docType }, FILTER_OFF)).id),
      workflow: em.getReference(Workflow, (await em.findOneOrFail(Workflow, { company }, FILTER_OFF)).id),
      createdBy: em.getReference(AppUser, G.userId), status: DocStatus.COMPLETED,
      exchangeRate: '1', approvedAt: at, createdAt: new Date(),
      vendorInvoiceNo: invoice?.no, vendorInvoiceDate: invoice?.date,
    } as never);
    await em.flush();
    em.create(BudgetTxn, { budget: em.getReference(Budget, budget), document: doc, txnType: BudgetTxnType.ACTUAL, txnDate: TODAY, amount: '100.00', createdAt: new Date() } as never);
    await em.flush();
    return doc.id;
  }

  /** Give company B a payable account + mapping so it can post at all. */
  async function mapPayableForB(): Promise<void> {
    const em = orm.em.fork();
    if (await em.findOne(AccountRole, { company: ids.companyB, role: AccountRoleType.CLAIM_PAYABLE }, FILTER_OFF)) return;
    const account = em.create(Account, {
      company: em.getReference(Company, ids.companyB), code: '2100', name: 'Claim payable B',
      accountType: 'LIABILITY', isPostable: true, isActive: true,
    } as never);
    await em.flush();
    em.create(AccountRole, { company: em.getReference(Company, ids.companyB), role: AccountRoleType.CLAIM_PAYABLE, account } as never);
    await em.flush();
  }

  const setTimezone = async (companyId: string, timezone: string) => {
    const em = orm.em.fork();
    const c = await em.findOneOrFail(Company, { id: companyId }, FILTER_OFF);
    c.timezone = timezone;
    await em.flush();
  };

  it('keeps a late-evening approval west of UTC in its own month', async () => {
    // The opposite direction from the payment case: at UTC−4, 23:00 local on 31 July is 03:00 UTC
    // on 1 August, so `toISOString()` dated this accrual into the NEXT month — it moved a figure
    // forward across a close. The company day keeps it in July.
    await mapPayableForB();
    await setTimezone(ids.companyB, 'America/New_York');

    const docId = await approvedAt(
      ids.companyB, ids.deptB, ids.dtAccrueB, ids.budgetB,
      new Date('2026-08-01T03:00:00Z'), 'TZ-WEST',
    );
    await posting.postAccrualForApproval(docId);
    expect((await entryFor(docId))!.entryDate).toBe('2026-07-31');
  });

  it('dates the accrual on the tax invoice, not on the approval', async () => {
    // The tax point for input VAT is the supplier's invoice. `approved_at` is the moment somebody
    // clicked approve, which is not an accounting fact about the purchase.
    await mapPayableForB();
    await setTimezone(ids.companyB, 'UTC');
    const docId = await approvedAt(
      ids.companyB, ids.deptB, ids.dtAccrueB, ids.budgetB,
      new Date('2026-09-20T03:00:00Z'), 'INV-DATE',
      { no: 'SUP-001', date: '2026-09-02' },
    );
    await posting.postAccrualForApproval(docId);

    const entry = await entryFor(docId);
    expect(entry!.entryDate).toBe('2026-09-02');
    expect(entry!.memo).toContain('SUP-001');
  });

  it('falls back to the approval date when the invoice month is already closed', async () => {
    // A late invoice is ordinary. Dating strictly by it would leave the posting in the undelivered
    // queue, blocking the next close until somebody reopened a reported month — a worse answer than
    // a slightly late claim.
    await mapPayableForB();
    await setTimezone(ids.companyB, 'UTC');
    const em = orm.em.fork();
    const fy = await em.findOneOrFail(FiscalYear, { company: ids.companyB }, FILTER_OFF);
    em.create(AccountingPeriod, {
      company: em.getReference(Company, ids.companyB), fiscalYear: fy, code: 'CLOSED-OCT',
      periodStart: '2026-10-01', periodEnd: '2026-10-31',
      status: 'CLOSED', createdAt: new Date(),
    } as never);
    await em.flush();

    const docId = await approvedAt(
      ids.companyB, ids.deptB, ids.dtAccrueB, ids.budgetB,
      new Date('2026-11-05T03:00:00Z'), 'INV-LATE',
      { no: 'SUP-002', date: '2026-10-28' },
    );
    await posting.postAccrualForApproval(docId);

    const entry = await entryFor(docId);
    expect(entry!.entryDate).toBe('2026-11-05');
    expect(entry!.memo).toContain('closed period');
    expect(entry!.memo).toContain('2026-10-28');

    await orm.em.fork().nativeDelete(AccountingPeriod, { code: 'CLOSED-OCT' }, FILTER_OFF);
  });

  it('dates the same instant differently for two companies in different zones', async () => {
    // The day is resolved per company, not per server: one instant, two companies, two dates.
    await mapPayableForB();
    await setTimezone(ids.companyA, 'Asia/Vientiane'); // UTC+7
    await setTimezone(ids.companyB, 'UTC');

    const instant = new Date('2026-07-31T22:00:00Z');
    const inA = await approvedAt(ids.companyA, ids.deptA, ids.dtAccrue, ids.budget, instant, 'TZ-A');
    const inB = await approvedAt(ids.companyB, ids.deptB, ids.dtAccrueB, ids.budgetB, instant, 'TZ-B');
    await posting.postAccrualForApproval(inA);
    await posting.postAccrualForApproval(inB);

    expect((await entryFor(inA))!.entryDate).toBe('2026-08-01'); // 05:00 the next morning there
    expect((await entryFor(inB))!.entryDate).toBe('2026-07-31'); // still the same day at UTC
  });
});

describe.skipIf(!hasDb)('document type recognises its expense once (DB-backed)', () => {
  let orm: MikroORM;
  let types: DocumentTypeService;
  let companyId = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const company = em.create(Company, { code: 'C', nameTh: 'C', taxId: 'C', branchCode: '00000', isActive: true });
    em.create(DocumentCategory, { company, code: DocCategory.FINANCE, name: 'F', isActive: true });
    await em.flush();
    companyId = company.id;
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  beforeEach(() => {
    types = new DocumentTypeService(orm.em.fork());
  });

  const asCompany = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: 'u', companyId, departmentId: 'd', grants: [] }, fn);

  // Each type below also requires a VENDOR. A payee is that vendor's bank account, and a vendor is
  // what makes an accruing type a purchase whose reference chain carries the charge its accrual
  // reads. The reference configuration ships exactly that shape — DISB. What these tests assert,
  // that accrual and payee may be combined at all, is unchanged.
  it('accepts a type that both accrues and requires a payee', async () => {
    // Rejected until accounts payable existed, because both the accrual and the settlement posting
    // debited the same expense accounts. The settlement now clears the payable the accrual raised,
    // so a purchase type recognises its expense once — at approval — and its payment moves only
    // cash and the payable.
    const created = await asCompany(() =>
      types.create({ code: 'BOTH', name: 'Both', category: DocCategory.FINANCE, accruesOnApproval: true, requiresPayee: true, requiresVendor: true } as never),
    );
    expect(created.accruesOnApproval).toBe(true);
    expect(created.requiresPayee).toBe(true);
  });

  it('accepts requiring a payee on a type that already accrues', async () => {
    const created = await asCompany(() =>
      types.create({ code: 'ACC', name: 'Accrues', category: DocCategory.FINANCE, accruesOnApproval: true, requiresVendor: true } as never),
    );
    const updated = await asCompany(() => types.update(created.id, { requiresPayee: true } as never));
    expect(updated.requiresPayee).toBe(true);
  });

  it('accepts accruing on a type that already requires a payee', async () => {
    const created = await asCompany(() =>
      types.create({ code: 'PAY', name: 'Payee', category: DocCategory.FINANCE, requiresPayee: true, requiresVendor: true } as never),
    );
    const updated = await asCompany(() => types.update(created.id, { accruesOnApproval: true } as never));
    expect(updated.accruesOnApproval).toBe(true);
  });

  it('accepts each on its own', async () => {
    const a = await asCompany(() =>
      types.create({ code: 'A1', name: 'A1', category: DocCategory.FINANCE, accruesOnApproval: true, requiresVendor: true } as never),
    );
    const b = await asCompany(() =>
      types.create({ code: 'B1', name: 'B1', category: DocCategory.FINANCE, requiresPayee: true, requiresVendor: true } as never),
    );
    expect(a.accruesOnApproval).toBe(true);
    expect(b.requiresPayee).toBe(true);
  });

  it('defaults to false so existing types are unchanged', async () => {
    const plain = await asCompany(() =>
      types.create({ code: 'P1', name: 'P1', category: DocCategory.FINANCE } as never),
    );
    expect(plain.accruesOnApproval).toBe(false);
  });
});

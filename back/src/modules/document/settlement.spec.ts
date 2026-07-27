import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeyDenyGuard } from '../../auth/api-key-deny.guard';
import { PERMISSIONS_KEY } from '../../auth/require-permissions.decorator';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { StorageService } from '../../common/storage/storage.service';
import {
  AccountRoleType, ApproveAction, BudgetTxnType, ControlPolicy, DocCategory, DocStatus, Scope,
} from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Account } from '../accounting/accounting.entities';
import { AccountService } from '../accounting/account.service';
import { ApprovalRoutingService } from '../approval/approval-routing.service';
import { ApproverResolverService } from '../approval/approver-resolver.service';
import { PostActionService } from '../approval/post-action.service';
import { WorkflowStepResolver } from '../approval/workflow-step.resolver';
import { Workflow, WorkflowStep } from '../approval/approval.entities';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { BudgetService } from '../budget/budget.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { Currency } from '../currency/currency.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { AccountRoleService } from '../gl/account-role.service';
import { AccountRole, JournalEntry, JournalLine } from '../gl/gl.entities';
import { GlPostingService } from '../gl/gl-posting.service';
import { GlPostingListener } from '../gl/gl-posting.listener';
import { ItemService } from '../master-data/item.service';
import { VendorService } from '../master-data/vendor.service';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { AppUser, Permission, Role, RolePermission, UserCompanyRole } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { DocumentSubmitService } from './document-submit.service';
import { NumberingService } from './numbering.service';
import { SettlementService } from './settlement.service';
import {
  DeptDocType, Document, DocumentAttachment, DocumentCategory, DocumentSettlement, DocumentType,
  FormTemplate,
} from './document.entities';
import type { UploadedFile } from '../../common/storage/upload';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;
const G = { userId: '', approverId: '' };

const evidence = (name = 'slip.png'): UploadedFile =>
  ({ originalname: name, buffer: Buffer.from('slip'), size: 4, mimetype: 'image/png' }) as UploadedFile;

/**
 * Recording that a compensation was paid, and clearing the payable its approval raised.
 *
 * The whole point of the transaction boundary here is that a settlement recorded without its
 * ledger effect would be worse than one refused — the operator would believe the books were
 * straight. Several of these tests exist only to prove that nothing survives a failure.
 */
describe.skipIf(!hasDb)('settlement (DB-backed)', () => {
  let orm: MikroORM;
  let settlements: SettlementService;
  let posting: GlPostingService;
  let routing: ApprovalRoutingService;
  let documents: DocumentService;
  let submitSvc: DocumentSubmitService;
  let storage: StorageService;
  let posted: Promise<void>;

  const ids = {
    companyA: '', deptA: '', dtAccrue: '', dtPlain: '', expense: '', payable: '', cash: '',
    companyB: '', deptB: '', dtAccrueB: '',
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
      em.create(Budget, {
        fiscalYear: fy, department: dept, glAccount: '5210', account: expense,
        budgetName: 'Claims', amountTotal: '1000000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE',
      } as never);
      const mkType = (tCode: string, accrues: boolean) => {
        const dt = em.create(DocumentType, {
          company, code: tCode, name: tCode, category: DocCategory.FINANCE,
          requiresBudget: true, requiresQuota: false, defaultGlAccount: '5210',
          postAction: 'CUT_BUDGET', accruesOnApproval: accrues, isActive: true,
        } as never);
        const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
        em.create(DeptDocType, { department: dept, documentType: dt, formTemplate: tmpl, workflow: wf, isActive: true });
        return dt;
      };
      return { company, dept, wf, expense, mkType };
    };

    const a = mk('A');
    const b = mk('B');
    const dtAccrue = a.mkType('CLAIM', true);
    const dtPlain = a.mkType('MEMO', false);
    const dtAccrueB = b.mkType('CLAIM', true);

    // Company A maps both roles; company B maps only the payable, so its settlement fails at the
    // credit side — the case that proves nothing survives a failed posting.
    const payable = em.create(Account, { company: a.company, code: '2130', name: 'Claim payable', accountType: 'LIABILITY', isPostable: true, isActive: true } as never);
    const cash = em.create(Account, { company: a.company, code: '1110', name: 'Cash clearing', accountType: 'ASSET', isPostable: true, isActive: true } as never);
    em.create(AccountRole, { company: a.company, role: AccountRoleType.CLAIM_PAYABLE, account: payable } as never);
    em.create(AccountRole, { company: a.company, role: AccountRoleType.CASH_CLEARING, account: cash } as never);
    const payableB = em.create(Account, { company: b.company, code: '2130', name: 'Claim payable', accountType: 'LIABILITY', isPostable: true, isActive: true } as never);
    em.create(AccountRole, { company: b.company, role: AccountRoleType.CLAIM_PAYABLE, account: payableB } as never);

    const role = em.create(Role, { company: a.company, code: 'APPR', name: 'Approver', isActive: true } as never);
    em.create(WorkflowStep, { workflow: a.wf, stepNo: 1, stepName: 'Head', approverRole: role, approveMode: 'SEQUENTIAL', showSignatureOnPdf: true } as never);
    const perm = em.create(Permission, { code: 'DOC_APPROVE', name: 'DOC_APPROVE', module: 'DOC', isActive: true });
    em.create(RolePermission, { role, permission: perm, scope: Scope.COMPANY } as never);
    em.create(UserCompanyRole, { user: approver, company: a.company, department: a.dept, role, isDefault: true } as never);
    const roleB = em.create(Role, { company: b.company, code: 'APPR', name: 'Approver', isActive: true } as never);
    em.create(WorkflowStep, { workflow: b.wf, stepNo: 1, stepName: 'Head', approverRole: roleB, approveMode: 'SEQUENTIAL', showSignatureOnPdf: true } as never);
    em.create(RolePermission, { role: roleB, permission: perm, scope: Scope.COMPANY } as never);
    em.create(UserCompanyRole, { user: approver, company: b.company, department: b.dept, role: roleB, isDefault: false } as never);

    await em.flush();
    G.userId = user.id;
    G.approverId = approver.id;
    Object.assign(ids, {
      companyA: a.company.id, deptA: a.dept.id, dtAccrue: dtAccrue.id, dtPlain: dtPlain.id,
      expense: a.expense.id, payable: payable.id, cash: cash.id,
      companyB: b.company.id, deptB: b.dept.id, dtAccrueB: dtAccrueB.id,
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
    posting = new GlPostingService(orm.em, new AccountRoleService(orm.em), accounts);
    storage = new StorageService();
    vi.spyOn(storage, 'putObject').mockResolvedValue(undefined as never);
    settlements = new SettlementService(orm.em, storage, posting);

    const budgetLedger = new BudgetLedgerService(orm.em, new BudgetBalanceService(orm.em));
    const items = new ItemService(orm.em, scope, new ScopeService(), accounts);
    submitSvc = new DocumentSubmitService(
      orm.em, new ExchangeRateService(orm.em), new FiscalYearService(scope),
      new VendorService(orm.em, scope, new ScopeService()), items, budgetLedger,
      new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em)),
    );
    documents = new DocumentService(
      orm.em, scope, new DeptDocTypeService(orm.em), new NumberingService(orm.em), items,
      new BudgetService(orm.em, accounts), new FiscalYearService(scope),
    );
    const emitter = new EventEmitter2();
    const listener = new GlPostingListener(posting);
    posted = Promise.resolve();
    emitter.on('approval.outcome', (e: { documentId: string; status: string }) => {
      posted = listener.onApprovalOutcome(e);
    });
    routing = new ApprovalRoutingService(
      orm.em, new ApproverResolverService(orm.em),
      new PostActionService(budgetLedger, orm.em, documents), submitSvc,
      new WorkflowStepResolver(orm.em), emitter,
    );
  });

  const asReq = <T>(companyId: string, departmentId: string, fn: () => Promise<T>) =>
    RequestContext.run({ userId: G.userId, companyId, departmentId, grants: [] }, fn);
  const asApprover = <T>(companyId: string, departmentId: string, fn: () => Promise<T>) =>
    RequestContext.run(
      { userId: G.approverId, companyId, departmentId, grants: [{ code: 'DOC_APPROVE', scope: Scope.COMPANY }] as never },
      fn,
    );

  /** Create → submit → approve, so the accrual exists before anything is settled. */
  async function accruedDocument(documentTypeId: string, amount: string, companyId = ids.companyA, deptId = ids.deptA) {
    const doc = await asReq(companyId, deptId, () =>
      documents.createDraft({
        documentTypeId,
        lines: [{ lineNo: 1, description: 'ค่าชดเชย', qty: '1', unitPrice: amount, lineAmount: amount }],
      } as never),
    );
    await asReq(companyId, deptId, () => submitSvc.submit(doc.id));
    await routing.start(doc.id);
    await asApprover(companyId, deptId, () => routing.act(doc.id, { action: ApproveAction.APPROVE } as never));
    await posted;
    return doc.id;
  }

  const entry = (documentId: string, sourceType: string) =>
    orm.em.fork().findOne(JournalEntry, { sourceType, sourceId: documentId }, FILTER_OFF);
  const linesOf = (entryId: string) =>
    orm.em.fork().find(JournalLine, { journalEntry: entryId }, { ...FILTER_OFF, populate: ['account'] });
  const dto = (over: Record<string, unknown> = {}) =>
    ({ settlementType: 'CASH', settledAt: '2026-07-27', reference: 'TXN-9001', ...over }) as never;

  it('clears the payable and records who paid it, with the evidence', async () => {
    const docId = await accruedDocument(ids.dtAccrue, '4500');

    const settlement = await RequestContext.run(
      { userId: G.approverId, companyId: ids.companyA, departmentId: ids.deptA, grants: [] },
      () => settlements.record(docId, dto(), evidence()),
    );

    expect(settlement.settlementType).toBe('CASH');
    expect(settlement.reference).toBe('TXN-9001');
    expect(settlement.settledBy.id).toBe(G.approverId);

    const clearing = await entry(docId, 'CLAIM_SETTLEMENT');
    expect(clearing).not.toBeNull();
    const lines = await linesOf(clearing!.id);
    expect(lines.find((l) => l.account.id === ids.payable)?.debit).toBe('4500.00');
    expect(lines.find((l) => l.account.id === ids.cash)?.credit).toBe('4500.00');

    // Across both entries the payable nets to zero and the expense is recognised once.
    const accrual = await entry(docId, 'APPROVAL_ACCRUAL');
    const all = [...(await linesOf(accrual!.id)), ...lines];
    const payableNet = all
      .filter((l) => l.account.id === ids.payable)
      .reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0);
    expect(payableNet).toBe(0);

    // The evidence is an attachment of the document.
    const attachments = await orm.em.fork().find(DocumentAttachment, { document: docId }, FILTER_OFF);
    expect(attachments).toHaveLength(1);
    expect(attachments[0].fileName).toBe('slip.png');
  });

  it('refuses a second settlement and leaves the first untouched', async () => {
    const docId = await accruedDocument(ids.dtAccrue, '1000');
    const ctx = <T>(fn: () => Promise<T>) =>
      RequestContext.run({ userId: G.approverId, companyId: ids.companyA, departmentId: ids.deptA, grants: [] }, fn);

    const first = await ctx(() => settlements.record(docId, dto(), evidence()));
    await expect(ctx(() => settlements.record(docId, dto({ reference: 'TXN-OTHER' }), evidence()))).rejects.toThrow(
      BadRequestException,
    );

    const stored = await orm.em.fork().find(DocumentSettlement, { document: docId }, FILTER_OFF);
    expect(stored).toHaveLength(1);
    expect(stored[0].reference).toBe(first.reference);
  });

  it('writes nothing at all when no evidence is attached', async () => {
    const docId = await accruedDocument(ids.dtAccrue, '800');
    await expect(
      RequestContext.run({ userId: G.approverId, companyId: ids.companyA, departmentId: ids.deptA, grants: [] }, () =>
        settlements.record(docId, dto(), undefined),
      ),
    ).rejects.toThrow(/evidence/i);

    expect(await orm.em.fork().count(DocumentSettlement, { document: docId }, FILTER_OFF)).toBe(0);
    expect(await orm.em.fork().count(DocumentAttachment, { document: docId }, FILTER_OFF)).toBe(0);
    expect(await entry(docId, 'CLAIM_SETTLEMENT')).toBeNull();
  });

  it('rolls everything back when the ledger cannot post', async () => {
    // Company B maps CLAIM_PAYABLE but not CASH_CLEARING. The settlement must not survive its own
    // failed posting — this is the case the transaction boundary exists for.
    const docId = await accruedDocument(ids.dtAccrueB, '2000', ids.companyB, ids.deptB);

    await expect(
      RequestContext.run({ userId: G.approverId, companyId: ids.companyB, departmentId: ids.deptB, grants: [] }, () =>
        settlements.record(docId, dto(), evidence()),
      ),
    ).rejects.toThrow();

    expect(await orm.em.fork().count(DocumentSettlement, { document: docId }, FILTER_OFF)).toBe(0);
    expect(await orm.em.fork().count(DocumentAttachment, { document: docId }, FILTER_OFF)).toBe(0);
    expect(await entry(docId, 'CLAIM_SETTLEMENT')).toBeNull();
    // And the document itself is untouched.
    const stored = await orm.em.fork().findOneOrFail(Document, { id: docId }, FILTER_OFF);
    expect(stored.status).toBe(DocStatus.COMPLETED);
  });

  it('refuses a document type that does not accrue', async () => {
    const docId = await accruedDocument(ids.dtPlain, '600');
    await expect(
      RequestContext.run({ userId: G.approverId, companyId: ids.companyA, departmentId: ids.deptA, grants: [] }, () =>
        settlements.record(docId, dto(), evidence()),
      ),
    ).rejects.toThrow(/does not accrue/i);
  });

  it('refuses a settlement type it cannot post', async () => {
    const docId = await accruedDocument(ids.dtAccrue, '500');
    await expect(
      RequestContext.run({ userId: G.approverId, companyId: ids.companyA, departmentId: ids.deptA, grants: [] }, () =>
        settlements.record(docId, dto({ settlementType: 'GOODS' }), evidence()),
      ),
    ).rejects.toThrow(/GOODS.*not supported/i);
    expect(await orm.em.fork().count(DocumentSettlement, { document: docId }, FILTER_OFF)).toBe(0);
  });

  it('writes no budget_txn — the budget settled at approval', async () => {
    const docId = await accruedDocument(ids.dtAccrue, '300');
    const before = await orm.em.fork().count(BudgetTxn, { document: docId }, FILTER_OFF);

    await RequestContext.run({ userId: G.approverId, companyId: ids.companyA, departmentId: ids.deptA, grants: [] }, () =>
      settlements.record(docId, dto(), evidence()),
    );

    expect(await orm.em.fork().count(BudgetTxn, { document: docId }, FILTER_OFF)).toBe(before);
    // And specifically nothing of a settling kind was added.
    const kinds = (await orm.em.fork().find(BudgetTxn, { document: docId }, FILTER_OFF)).map((t) => t.txnType);
    expect(kinds.filter((k) => k === BudgetTxnType.ACTUAL)).toHaveLength(1);
  });

  it('lists exactly the accrued documents that have not been settled', async () => {
    const unsettledId = await accruedDocument(ids.dtAccrue, '111');
    const settledId = await accruedDocument(ids.dtAccrue, '222');
    const plainId = await accruedDocument(ids.dtPlain, '333');

    await RequestContext.run({ userId: G.approverId, companyId: ids.companyA, departmentId: ids.deptA, grants: [] }, () =>
      settlements.record(settledId, dto(), evidence()),
    );

    const queue = await RequestContext.run(
      { userId: G.approverId, companyId: ids.companyA, departmentId: ids.deptA, grants: [] },
      () => settlements.listUnsettled(),
    );
    const queued = queue.map((q) => q.id);
    expect(queued).toContain(unsettledId);
    expect(queued).not.toContain(settledId);
    // A type that does not accrue was never in the queue: its payment is the payment flow's job.
    expect(queued).not.toContain(plainId);
  });

  it('posts the clearing entry once', async () => {
    const docId = await accruedDocument(ids.dtAccrue, '999');
    await RequestContext.run({ userId: G.approverId, companyId: ids.companyA, departmentId: ids.deptA, grants: [] }, () =>
      settlements.record(docId, dto(), evidence()),
    );
    // A second posting attempt for the same document is a no-op, not a second entry.
    await orm.em.transactional((tem) => posting.postSettlementClearing(tem, docId, 'CASH'));

    const entries = await orm.em.fork().find(
      JournalEntry, { sourceType: 'CLAIM_SETTLEMENT', sourceId: docId }, FILTER_OFF,
    );
    expect(entries).toHaveLength(1);
  });

  it('refuses to clear a payable that was never raised', async () => {
    // A document with no accrual entry: nothing to clear, so the posting must refuse rather than
    // debit a payable this document never credited.
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `NOACC-${Date.now()}`, company: em.getReference(Company, ids.companyA),
      department: em.getReference(Department, ids.deptA),
      documentType: em.getReference(DocumentType, ids.dtAccrue),
      formTemplate: em.getReference(FormTemplate, (await em.findOneOrFail(FormTemplate, { documentType: ids.dtAccrue }, FILTER_OFF)).id),
      workflow: em.getReference(Workflow, (await em.findOneOrFail(Workflow, { company: ids.companyA }, FILTER_OFF)).id),
      createdBy: em.getReference(AppUser, G.userId), status: DocStatus.COMPLETED,
      exchangeRate: '1', approvedAt: new Date(), createdAt: new Date(),
    } as never);
    await em.flush();

    await expect(
      RequestContext.run({ userId: G.approverId, companyId: ids.companyA, departmentId: ids.deptA, grants: [] }, () =>
        settlements.record(doc.id, dto(), evidence()),
      ),
    ).rejects.toThrow(/no accrual/i);
    expect(await orm.em.fork().count(DocumentSettlement, { document: doc.id }, FILTER_OFF)).toBe(0);
  });
});

/**
 * The channel cap on settling.
 *
 * Declaring that money left is not a machine's act. The controller accepts API keys, so without
 * the guard the claim system's own bot could record a payment nobody made — and the prohibition
 * has to sit on the authentication channel, where no grant can turn it on. Asserted against the
 * route's metadata because what silently regresses is the decorator going missing, not the guard.
 */
describe('settle is barred to API keys', () => {
  it('denies a key-authenticated request even when the bound user may manage payments', () => {
    const guard = new ApiKeyDenyGuard();
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { authSource: 'api-key', permissions: ['PAYMENT_MANAGE'] } }),
      }),
    } as never;
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('carries ApiKeyDenyGuard on the settle route', () => {
    const guards = Reflect.getMetadata('__guards__', DocumentController.prototype.settle) ?? [];
    expect(guards).toContain(ApiKeyDenyGuard);
  });

  it('requires the payment-management permission, not a document one', () => {
    const codes = Reflect.getMetadata(PERMISSIONS_KEY, DocumentController.prototype.settle) ?? [];
    expect(codes).toContain('PAYMENT_MANAGE');
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { AccountType, ApproveAction, DocCategory, DocStatus, Scope } from '../../common/enums';
import { ErrorCode, isCoded } from '../../common/errors/error-code';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { signAllUsers } from '../../test/signature-fixture';
import { Account } from '../accounting/accounting.entities';
import { AccountService } from '../accounting/account.service';
import { ApprovalRoutingService } from '../approval/approval-routing.service';
import { ApproverResolverService } from '../approval/approver-resolver.service';
import { DocumentRouteService } from '../approval/document-route.service';
import { WorkflowStepResolver } from '../approval/workflow-step.resolver';
import { ApprovalLog, DocumentApprovalStep, Workflow, WorkflowStep } from '../approval/approval.entities';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetService } from '../budget/budget.service';
import { BudgetTxn } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { JournalEntry } from '../gl/gl.entities';
import { ItemService } from '../master-data/item.service';
import { Item, ItemCompany } from '../master-data/master-data.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { AppUser, Role, UserCompanyRole } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentLineRecodeService } from './document-line-recode.service';
import { DocumentService } from './document.service';
import { Document, DocumentLine, DocumentType, FormTemplate } from './document.entities';
import { NumberingService } from './numbering.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * A step may let its approver move the account a line posts to.
 *
 * What is tested is the ORDER of every refusal relative to the write, not merely that it refuses:
 * `approval_log` is append-only, so a recode that must be refused has to be refused before its row
 * exists. Every negative case asserts the line is as it was AND the log is as it was. The positive
 * case asserts what did NOT move — budget, amounts, `budget_txn`, the item's default, the budget's
 * account — because "changes only the account" is the whole promise.
 */
describe.skipIf(!hasDb)('a step may allow its approver to re-code a line account (DB-backed)', () => {
  let orm: MikroORM;
  let routing: ApprovalRoutingService;
  let recode: DocumentLineRecodeService;
  let documents: DocumentService;
  let seq = 0;

  const ids = {
    company: '', other: '', dept: '', dt: '', tmpl: '', role: '',
    creator: '', a1: '', a2: '', outsider: '',
    acc606: '', acc636: '', accHeader: '', accInactive: '', accOther: '',
    item: '',
  };

  // Company-wide DOC_VIEW so the detail read is about the recode flags, not about visibility —
  // an outsider who can SEE the document is exactly the viewer who must be told they cannot act.
  const asUser = <T>(userId: string, fn: () => Promise<T>) =>
    RequestContext.run(
      { userId, companyId: ids.company, departmentId: ids.dept, grants: [{ code: 'DOC_VIEW', scope: Scope.COMPANY }] },
      fn,
    );

  async function workflow(steps: Array<Partial<WorkflowStep> & { stepNo: number }>): Promise<string> {
    const em = orm.em.fork();
    const wf = em.create(Workflow, {
      company: em.getReference(Company, ids.company),
      name: `RECODE-WF-${seq++}`,
      isActive: true,
    });
    for (const s of steps) {
      em.create(WorkflowStep, {
        workflow: wf,
        stepNo: s.stepNo,
        approverUser: s.approverUser,
        approveMode: s.approveMode ?? 'SEQUENTIAL',
        showSignatureOnPdf: true,
        requiresPaymentSlip: false,
        allowsAccountRecode: s.allowsAccountRecode ?? false,
      });
    }
    await em.flush();
    return wf.id;
  }

  /** A submitted document with two priced lines stamped 606, and one zero line, no budget. */
  async function submitted(workflowId: string, opts: { withItem?: boolean } = {}): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `RECODE-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, ids.dt),
      formTemplate: em.getReference(FormTemplate, ids.tmpl),
      workflow: em.getReference(Workflow, workflowId),
      currentStepNo: 0,
      createdBy: em.getReference(AppUser, ids.creator),
      exchangeRate: '1',
      totalAmount: '30',
      baseTotalAmount: '30',
      status: DocStatus.SUBMITTED,
      submittedAt: new Date(),
      createdAt: new Date(),
    });
    await em.flush();
    const line = (lineNo: number, amount: string) =>
      em.create(DocumentLine, {
        document: doc,
        lineNo,
        description: `line ${lineNo}`,
        qty: '1',
        unitPrice: amount,
        lineAmount: amount,
        baseLineAmount: amount,
        budgetBaseLineAmount: amount,
        glAccount: '606.03',
        account: em.getReference(Account, ids.acc606),
        item: opts.withItem && lineNo === 1 ? em.getReference(Item, ids.item) : undefined,
      } as never);
    line(1, '10.00');
    line(2, '20.00');
    line(3, '0.00');
    await em.flush();
    return doc.id;
  }

  /** A workflow of one allowing step for a1, with a document already routing on it. */
  async function routingOnAllowingStep(): Promise<string> {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), allowsAccountRecode: true },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);
    return docId;
  }

  const lineOf = (documentId: string, lineNo: number) =>
    orm.em.fork().findOneOrFail(DocumentLine, { document: documentId, lineNo }, { ...FILTER_OFF, populate: ['account', 'budget'] });
  const logs = (documentId: string) =>
    orm.em.fork().find(ApprovalLog, { document: documentId }, { ...FILTER_OFF, orderBy: { actedAt: 'ASC' } });
  const reload = (id: string) => orm.em.fork().findOneOrFail(Document, { id }, FILTER_OFF);

  async function expectUntouched(documentId: string, lineNo = 1): Promise<void> {
    const l = await lineOf(documentId, lineNo);
    expect(l.account?.id).toBe(ids.acc606);
    expect(l.glAccount).toBe('606.03');
    expect((await logs(documentId)).filter((r) => r.action === ApproveAction.RECODE_ACCOUNT)).toHaveLength(0);
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const lak = em.create(Currency, { code: 'LAK', name: 'Kip', decimalPlaces: 2, isActive: true });
    const company = em.create(Company, {
      code: 'R', nameTh: 'R', taxId: '1', branchCode: '00000', baseCurrency: lak, isActive: true,
    });
    const other = em.create(Company, {
      code: 'O', nameTh: 'O', taxId: '2', branchCode: '00000', baseCurrency: lak, isActive: true,
    });
    const dept = em.create(Department, { company, deptCode: 'D', name: 'D', isActive: true });
    const y = new Date().getUTCFullYear();
    em.create(FiscalYear, { company, year: y, startDate: `${y}-01-01`, endDate: `${y}-12-31`, status: 'OPEN' });
    const role = em.create(Role, { company, code: 'ACC', name: 'Accounting', isActive: true });
    const mk = (n: string) => em.create(AppUser, { username: n, email: `${n}@x`, status: 'ACTIVE' });
    const creator = mk('r-creator');
    const a1 = mk('r-a1');
    const a2 = mk('r-a2');
    const outsider = mk('r-outsider');
    for (const u of [a1, a2, outsider]) {
      em.create(UserCompanyRole, { user: u, company, department: dept, role, isDefault: false });
    }
    const dt = em.create(DocumentType, {
      company, code: 'RMEMO', name: 'Memo', category: DocCategory.ADMIN,
      requiresBudget: false, requiresQuota: false, isActive: true,
    });
    const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });

    const acc = (c: Company, code: string, extra: Partial<Account> = {}) =>
      em.create(Account, { company: c, code, name: code, accountType: AccountType.EXPENSE, isPostable: true, isActive: true, ...extra });
    const acc606 = acc(company, '606.03');
    const acc636 = acc(company, '636.04');
    const accHeader = acc(company, '600', { isPostable: false });
    const accInactive = acc(company, '699.99', { isActive: false });
    const accOther = acc(other, '636.04');

    const item = em.create(Item, { itemCode: 'COFFEE', name: 'Coffee beans', isActive: true } as never);
    em.create(ItemCompany, { item, company, isActive: true, defaultGlAccount: '606.03' } as never);

    await em.flush();
    Object.assign(ids, {
      company: company.id, other: other.id, dept: dept.id, dt: dt.id, tmpl: tmpl.id, role: role.id,
      creator: creator.id, a1: a1.id, a2: a2.id, outsider: outsider.id,
      acc606: acc606.id, acc636: acc636.id, accHeader: accHeader.id, accInactive: accInactive.id, accOther: accOther.id,
      item: item.id,
    });

    const em2 = orm.em.fork();
    const resolver = new ApproverResolverService(em2);
    const route = new DocumentRouteService(em2, new WorkflowStepResolver(em2), resolver);
    const postAction = {
      assertApprovable: async () => undefined,
      run: async () => ({ paymentReady: false, stockTxnIds: [] as string[] }),
    } as never;
    const documentSubmit = { releaseDocumentHolds: async () => undefined, markPlanRejected: async () => undefined } as never;
    routing = new ApprovalRoutingService(em2, resolver, postAction, documentSubmit, route);
    recode = new DocumentLineRecodeService(orm.em, route, resolver);

    const scope = new CompanyScopeService(orm.em);
    const accounts = new AccountService(orm.em, scope);
    documents = new DocumentService(
      orm.em,
      scope,
      new DeptDocTypeService(orm.em),
      new NumberingService(orm.em),
      new ItemService(orm.em, scope, new ScopeService(), accounts),
      new BudgetService(orm.em, accounts, new BudgetBalanceService(orm.em)),
      new FiscalYearService(scope),
      undefined,
      undefined,
      route,
      resolver,
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

  // ---- the happy path, and what it does NOT do -------------------------------------------------

  it('moves one line to the named account, keeps gl_account in step, and writes one log row', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), allowsAccountRecode: true },
    ]);
    const docId = await submitted(wfId, { withItem: true });
    await routing.start(docId);
    const before = await lineOf(docId, 1);
    const txnsBefore = await orm.em.fork().count(BudgetTxn, { document: docId }, FILTER_OFF);

    const result = await asUser(ids.a1, () => recode.recode(docId, 1, ids.acc636));

    expect(result.from.code).toBe('606.03');
    expect(result.to.code).toBe('636.04');
    const after = await lineOf(docId, 1);
    expect(after.account?.id).toBe(ids.acc636);
    expect(after.glAccount).toBe('636.04');
    // Everything else on the line is what it was.
    expect(after.budget?.id).toBe(before.budget?.id);
    expect(after.lineAmount).toBe(before.lineAmount);
    expect(after.baseLineAmount).toBe(before.baseLineAmount);
    expect(after.budgetBaseLineAmount).toBe(before.budgetBaseLineAmount);
    expect(await orm.em.fork().count(BudgetTxn, { document: docId }, FILTER_OFF)).toBe(txnsBefore);
    // The other line, and master data, are untouched.
    expect((await lineOf(docId, 2)).account?.id).toBe(ids.acc606);
    const ic = await orm.em.fork().findOneOrFail(ItemCompany, { item: ids.item, company: ids.company }, FILTER_OFF);
    expect(ic.defaultGlAccount).toBe('606.03');
    // One attributed row, naming the move.
    const rows = (await logs(docId)).filter((r) => r.action === ApproveAction.RECODE_ACCOUNT);
    expect(rows).toHaveLength(1);
    expect(rows[0].stepNo).toBe(1);
    expect(rows[0].approver.id).toBe(ids.a1);
    expect(rows[0].remark).toBe('line 1: 606.03 → 636.04');
    // The route did not move.
    expect((await reload(docId)).currentStepNo).toBe(1);
    expect((await reload(docId)).status).toBe(DocStatus.IN_APPROVAL);
  });

  it('leaves the approve, and its posting, to read the recoded line', async () => {
    const docId = await routingOnAllowingStep();
    await asUser(ids.a1, () => recode.recode(docId, 1, ids.acc636));
    await asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE }));
    expect((await reload(docId)).status).toBe(DocStatus.COMPLETED);
    expect((await lineOf(docId, 1)).account?.id).toBe(ids.acc636);
  });

  // ---- refusals, each before the write ---------------------------------------------------------

  it('refuses a document that is not in approval, naming the status', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), allowsAccountRecode: true },
    ]);
    const docId = await submitted(wfId); // SUBMITTED, route not started
    const err = await asUser(ids.a1, () => recode.recode(docId, 1, ids.acc636)).catch((e) => e);
    expect(isCoded(err) && err.code).toBe(ErrorCode.INVALID_STATE);
    expect(String(err.message)).toMatch(/SUBMITTED/);
    await expectUntouched(docId);

    const done = await routingOnAllowingStep();
    await asUser(ids.a1, () => routing.act(done, { action: ApproveAction.APPROVE }));
    await expect(asUser(ids.a1, () => recode.recode(done, 1, ids.acc636))).rejects.toThrow(/COMPLETED/);
    await expectUntouched(done);
  });

  it('refuses when the current step does not allow it', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), allowsAccountRecode: false },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);
    await expect(asUser(ids.a1, () => recode.recode(docId, 1, ids.acc636))).rejects.toThrow(/does not allow/);
    await expectUntouched(docId);
  });

  it('reads the flag from the route, so turning it on after submit does not reach a routing document', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), allowsAccountRecode: false },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);

    const em = orm.em.fork();
    const step = await em.findOneOrFail(WorkflowStep, { workflow: wfId, stepNo: 1 }, FILTER_OFF);
    step.allowsAccountRecode = true;
    await em.flush();

    await expect(asUser(ids.a1, () => recode.recode(docId, 1, ids.acc636))).rejects.toThrow(/does not allow/);
    await expectUntouched(docId);

    // A document submitted afterwards runs the new terms.
    const later = await submitted(wfId);
    await routing.start(later);
    const rows = await orm.em.fork().find(DocumentApprovalStep, { document: later }, FILTER_OFF);
    expect(rows[0].allowsAccountRecode).toBe(true);
    await asUser(ids.a1, () => recode.recode(later, 1, ids.acc636));
    expect((await lineOf(later, 1)).account?.id).toBe(ids.acc636);
  });

  it('refuses a user who is not an eligible approver of the current step', async () => {
    const docId = await routingOnAllowingStep();
    await expect(asUser(ids.outsider, () => recode.recode(docId, 1, ids.acc636))).rejects.toThrow(/eligible/);
    await expect(asUser(ids.creator, () => recode.recode(docId, 1, ids.acc636))).rejects.toThrow(/eligible/);
    await expectUntouched(docId);
  });

  it('refuses once a journal entry names the document', async () => {
    const docId = await routingOnAllowingStep();
    const em = orm.em.fork();
    em.create(JournalEntry, {
      company: em.getReference(Company, ids.company),
      entryDate: new Date().toISOString().slice(0, 10),
      sourceType: 'ACCRUAL',
      sourceId: docId,
      memo: 'posted early',
      createdAt: new Date(),
    } as never);
    await em.flush();

    const err = await asUser(ids.a1, () => recode.recode(docId, 1, ids.acc636)).catch((e) => e);
    expect(isCoded(err) && err.code).toBe(ErrorCode.INVALID_STATE);
    expect(String(err.message)).toMatch(/journal entry/);
    await expectUntouched(docId);
  });

  it('refuses a line that posts nothing', async () => {
    const docId = await routingOnAllowingStep();
    await expect(asUser(ids.a1, () => recode.recode(docId, 3, ids.acc636))).rejects.toThrow(/no amount/);
    await expect(asUser(ids.a1, () => recode.recode(docId, 9, ids.acc636))).rejects.toThrow(/not found/);
    await expectUntouched(docId, 3);
  });

  it('refuses an account that is not postable, not active, or not of this company', async () => {
    const docId = await routingOnAllowingStep();
    for (const bad of [ids.accHeader, ids.accInactive, ids.accOther]) {
      await expect(asUser(ids.a1, () => recode.recode(docId, 1, bad))).rejects.toThrow(/active, postable/);
    }
    await expectUntouched(docId);
  });

  it('refuses a no-op recode without writing a log row', async () => {
    const docId = await routingOnAllowingStep();
    const err = await asUser(ids.a1, () => recode.recode(docId, 1, ids.acc606)).catch((e) => e);
    expect(isCoded(err) && err.code).toBe(ErrorCode.INVALID_STATE);
    await expectUntouched(docId);
  });

  it('is not-found for a document of another company', async () => {
    const docId = await routingOnAllowingStep();
    await expect(
      RequestContext.run(
        { userId: ids.a1, companyId: ids.other, departmentId: ids.dept, grants: [] },
        () => recode.recode(docId, 1, ids.accOther),
      ),
    ).rejects.toThrow(/not found/);
    await expectUntouched(docId);
  });

  // ---- concurrency -----------------------------------------------------------------------------

  it('serialises a recode against the final approval: never an approval on a line that then changes', async () => {
    for (let i = 0; i < 4; i++) {
      const docId = await routingOnAllowingStep();
      const [r, a] = await Promise.allSettled([
        asUser(ids.a1, () => recode.recode(docId, 1, ids.acc636)),
        asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE })),
      ]);
      expect(a.status).toBe('fulfilled');
      const doc = await reload(docId);
      expect(doc.status).toBe(DocStatus.COMPLETED);
      const line = await lineOf(docId, 1);
      const recodeRows = (await logs(docId)).filter((x) => x.action === ApproveAction.RECODE_ACCOUNT);
      if (r.status === 'fulfilled') {
        // The recode landed first: the approval read the recoded line.
        expect(line.account?.id).toBe(ids.acc636);
        expect(recodeRows).toHaveLength(1);
      } else {
        // The approval landed first: the recode was refused on status, and wrote nothing.
        expect(String((r as PromiseRejectedResult).reason?.message)).toMatch(/COMPLETED/);
        expect(line.account?.id).toBe(ids.acc606);
        expect(recodeRows).toHaveLength(0);
      }
    }
  });

  it('serialises two recodes of one line into two ordered log rows', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), allowsAccountRecode: true },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);
    // Both eligible: a1 is the principal; a2 is made a second principal by putting them on the
    // same step through a parallel route would need more setup — instead race a1 twice, which
    // exercises the same lock. The second is a no-op only if it targets the same account.
    const results = await Promise.allSettled([
      asUser(ids.a1, () => recode.recode(docId, 1, ids.acc636)),
      asUser(ids.a1, () => recode.recode(docId, 1, ids.acc606)),
    ]);
    // One of two orders: 606→636 then 636→606 (both fulfilled), or 606→606 refused as a no-op then
    // 606→636 (one fulfilled). Either way the rows say exactly what happened, in order.
    const rows = (await logs(docId)).filter((x) => x.action === ApproveAction.RECODE_ACCOUNT);
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    expect(rows).toHaveLength(fulfilled);
    const line = await lineOf(docId, 1);
    const last = rows[rows.length - 1]?.remark ?? '';
    if (fulfilled === 2) {
      expect(rows.map((x) => x.remark)).toEqual(['line 1: 606.03 → 636.04', 'line 1: 636.04 → 606.03']);
      expect(line.account?.id).toBe(ids.acc606);
    } else {
      expect(last).toBe('line 1: 606.03 → 636.04');
      expect(line.account?.id).toBe(ids.acc636);
    }
  });

  // ---- the detail read --------------------------------------------------------------------------

  it('tells the eligible approver they may re-code, and tells others why not', async () => {
    const docId = await routingOnAllowingStep();

    const forA1 = await asUser(ids.a1, () => documents.detail(docId));
    expect(forA1.accountRecodeAllowed).toBe(true);
    expect(forA1.canRecodeAccount).toBe(true);

    const forOutsider = await asUser(ids.outsider, () => documents.detail(docId));
    expect(forOutsider.accountRecodeAllowed).toBe(true);
    expect(forOutsider.canRecodeAccount).toBe(false);

    const forCreator = await asUser(ids.creator, () => documents.detail(docId));
    expect(forCreator.canRecodeAccount).toBe(false);

    await asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE }));
    const done = await asUser(ids.a1, () => documents.detail(docId));
    expect(done.canRecodeAccount).toBe(false);
  });

  it('reports a step that does not allow it', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), allowsAccountRecode: false },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);
    const d = await asUser(ids.a1, () => documents.detail(docId));
    expect(d.accountRecodeAllowed).toBe(false);
    expect(d.canRecodeAccount).toBe(false);
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[document-line-recode] no database reachable — skipping');
}

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { attachCoverage, budgetAt } from '../../test/budget-fixture';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ApproveAction, DocCategory, DocStatus, Scope } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { signAllUsers } from '../../test/signature-fixture';
import { AccountService } from '../accounting/account.service';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetService } from '../budget/budget.service';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { ItemService } from '../master-data/item.service';
import { VendorService } from '../master-data/vendor.service';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import { ApprovalLog, Workflow, WorkflowStep } from '../approval/approval.entities';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentSubmitService } from './document-submit.service';
import { DocumentService } from './document.service';
import { NumberingService } from './numbering.service';
import { DeptDocType, Document, DocumentType, FormTemplate } from './document.entities';
import { DocumentPermissions } from './permissions';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Who may withdraw a document.
 *
 * It used to be its creator and nobody else. That rule could not survive a document the SYSTEM
 * raises: a `CREATE_SUCCESSOR` pairing that names a successor department writes a document whose
 * `created_by` is the PREDECESSOR's requester — a person in another department — while its
 * `department` is the successor's. Withdrawal then belonged to someone who, at DEPARTMENT scope,
 * could not even see the document, while the department that owned the work could see it and had no
 * way to withdraw it. Neither party held both halves, and a duplicate draft could be removed by
 * nobody.
 *
 * So withdrawal is authorized the way every other document act is: `DOC_CANCEL` at the holder's
 * granted scope. OWN is exactly the old rule, which is what a company that wants it back grants.
 */
describe.skipIf(!hasDb)('withdrawal is authorized by scope (DB-backed)', () => {
  let orm: MikroORM;
  let submit: DocumentSubmitService;
  let documents: DocumentService;

  const ids = {
    company: '', otherCompany: '', deptA: '', deptB: '', otherDept: '',
    requester: '', procurement: '', stranger: '',
    type: '', tmpl: '', wf: '', budget: '',
  };
  let seq = 0;

  /** Act with one `DOC_CANCEL` grant at one scope, from one department. */
  const as = <T>(
    userId: string,
    departmentId: string,
    scope: Scope | null,
    fn: () => Promise<T>,
    companyId = ids.company,
  ): Promise<T> =>
    RequestContext.run(
      {
        userId,
        companyId,
        departmentId,
        grants: scope ? [{ code: DocumentPermissions.DOC_CANCEL, scope }] : [],
      } as never,
      fn,
    );

  /**
   * Act as someone who can READ the document as well as (perhaps) withdraw it. The detail is itself
   * narrowed by `DOC_VIEW`, so a reader who cannot see a document never reaches the question this
   * spec is about — they get not-found, which is a different answer from "you may not withdraw it".
   */
  const asViewing = <T>(
    userId: string,
    departmentId: string,
    viewScope: Scope,
    cancelScope: Scope,
    fn: () => Promise<T>,
  ): Promise<T> =>
    RequestContext.run(
      {
        userId,
        companyId: ids.company,
        departmentId,
        grants: [
          { code: 'DOC_VIEW', scope: viewScope },
          { code: DocumentPermissions.DOC_CANCEL, scope: cancelScope },
        ],
      } as never,
      fn,
    );

  /**
   * A document with an explicit creator and department, which is the whole point: for a hand-raised
   * document the two agree, and for a swept successor they do not.
   */
  async function doc(createdBy: string, departmentId: string, status = DocStatus.DRAFT): Promise<string> {
    const em = orm.em.fork();
    const d = em.create(Document, {
      docNo: `W-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, departmentId),
      documentType: em.getReference(DocumentType, ids.type),
      formTemplate: em.getReference(FormTemplate, ids.tmpl),
      workflow: em.getReference(Workflow, ids.wf),
      currentStepNo: 0,
      createdBy: em.getReference(AppUser, createdBy),
      exchangeRate: '1',
      totalAmount: '1000',
      status,
      createdAt: new Date(),
    });
    em.create('DocumentLine' as never, {
      document: d, lineNo: 1, description: 'thing', qty: '1', unitPrice: '1000',
      lineAmount: '1000', budget: em.getReference(Budget, ids.budget), lineStatus: 'OPEN',
      receivedQty: '0',
    } as never);
    await em.flush();
    return d.id;
  }

  const reload = (id: string): Promise<Document> =>
    orm.em.fork().findOneOrFail(Document, { id }, FILTER_OFF);

  const cancelRows = (id: string) =>
    orm.em.fork().find(ApprovalLog, { document: id, action: ApproveAction.CANCEL }, {
      ...FILTER_OFF,
      populate: ['approver'],
    });

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();

    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const otherCompany = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true });
    // A raises; B is where the pairing sweeps its successors.
    const deptA = em.create(Department, { company, deptCode: 'A', name: 'Requesting', isActive: true });
    const deptB = em.create(Department, { company, deptCode: 'B', name: 'Procurement', isActive: true });
    const otherDept = em.create(Department, { company: otherCompany, deptCode: 'X', name: 'X', isActive: true });

    const year = new Date().getUTCFullYear();
    const fy = em.create(FiscalYear, { company, year, startDate: `${year}-01-01`, endDate: `${year}-12-31`, status: 'OPEN' });

    const requester = em.create(AppUser, { username: 'requester', email: 'r@x', status: 'ACTIVE' });
    const procurement = em.create(AppUser, { username: 'procurement', email: 'p@x', status: 'ACTIVE' });
    const stranger = em.create(AppUser, { username: 'stranger', email: 's@x', status: 'ACTIVE' });

    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    em.create(WorkflowStep, { workflow: wf, stepNo: 1, approveMode: 'SEQUENTIAL', showSignatureOnPdf: true });

    const type = em.create(DocumentType, { company, code: 'PO', name: 'Purchase Order', category: DocCategory.PROCUREMENT, requiresBudget: true, requiresQuota: false, requiresVendor: false, requiresItem: false, requiresPayee: false, requiresWarehouse: false, postAction: 'CUT_BUDGET', isActive: true });
    const tmpl = em.create(FormTemplate, { documentType: type, version: 1, status: 'PUBLISHED' });
    for (const d of [deptA, deptB]) {
      em.create(DeptDocType, { department: d, documentType: type, formTemplate: tmpl, workflow: wf, isActive: true });
    }

    const budget = budgetAt(em, { fiscalYear: fy, department: deptA, code: 'GL1', glAccount: 'GL1', amountTotal: '1000000', controlPolicy: 'HARD_STOP', status: 'ACTIVE' });
    attachCoverage(em, company, budget);
    await em.flush();

    Object.assign(ids, {
      company: company.id, otherCompany: otherCompany.id,
      deptA: deptA.id, deptB: deptB.id, otherDept: otherDept.id,
      requester: requester.id, procurement: procurement.id, stranger: stranger.id,
      type: type.id, tmpl: tmpl.id, wf: wf.id, budget: budget.id,
    });

    const scope = new CompanyScopeService(orm.em);
    const accounts = new AccountService(orm.em, scope);
    const balance = new BudgetBalanceService(orm.em);
    const vendors = new VendorService(orm.em, scope, new ScopeService());
    documents = new DocumentService(
      orm.em, scope, new DeptDocTypeService(orm.em), new NumberingService(orm.em),
      new ItemService(orm.em, scope, new ScopeService(), accounts),
      new BudgetService(orm.em, accounts, balance), new FiscalYearService(scope),
    );
    submit = new DocumentSubmitService(
      orm.em,
      new ExchangeRateService(orm.em, scope),
      new FiscalYearService(scope),
      vendors,
      new ItemService(orm.em, scope, new ScopeService(), accounts),
      new BudgetLedgerService(orm.em, balance, new BudgetCoverageService(orm.em)),
      new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em)),
    );
    await signAllUsers(orm.em);
  });

  beforeEach(async () => {
    await orm.em.fork().nativeDelete(BudgetTxn, {}, FILTER_OFF);
  });

  // ---- What the change exists for ------------------------------------------------

  it('lets the owning department withdraw a document the system raised into it', async () => {
    // The swept successor: raised by the predecessor's requester, who lives in department A, but
    // written into department B, where the work actually is.
    const swept = await doc(ids.requester, ids.deptB);

    await as(ids.procurement, ids.deptB, Scope.DEPARTMENT, () => submit.cancel(swept));

    expect((await reload(swept)).status).toBe(DocStatus.CANCELLED);
  });

  it('names the person who actually withdrew it, not the creator', async () => {
    const swept = await doc(ids.requester, ids.deptB);

    await as(ids.procurement, ids.deptB, Scope.DEPARTMENT, () => submit.cancel(swept, { remark: 'duplicate' }));

    const rows = await cancelRows(swept);
    expect(rows).toHaveLength(1);
    expect(rows[0].approver.id).toBe(ids.procurement);
    expect(rows[0].remark).toBe('duplicate');
  });

  // ---- OWN is exactly the old rule -------------------------------------------------

  it('lets an OWN-scope holder withdraw their own document', async () => {
    const mine = await doc(ids.requester, ids.deptA);

    await as(ids.requester, ids.deptA, Scope.OWN, () => submit.cancel(mine));

    expect((await reload(mine)).status).toBe(DocStatus.CANCELLED);
  });

  it("refuses an OWN-scope holder someone else's document", async () => {
    const theirs = await doc(ids.requester, ids.deptA);

    await expect(
      as(ids.stranger, ids.deptA, Scope.OWN, () => submit.cancel(theirs)),
    ).rejects.toThrow(ForbiddenException);
    expect((await reload(theirs)).status).toBe(DocStatus.DRAFT);
  });

  it('collapses an ungranted DOC_CANCEL to OWN rather than to nothing', async () => {
    // Fail-safe direction: no grant must mean the narrowest rule, never the widest.
    const theirs = await doc(ids.requester, ids.deptA);

    await expect(
      as(ids.stranger, ids.deptA, null, () => submit.cancel(theirs)),
    ).rejects.toThrow(ForbiddenException);
  });

  // ---- DEPARTMENT and COMPANY --------------------------------------------------------

  it("refuses a DEPARTMENT-scope holder another department's document", async () => {
    const inB = await doc(ids.requester, ids.deptB);

    await expect(
      as(ids.stranger, ids.deptA, Scope.DEPARTMENT, () => submit.cancel(inB)),
    ).rejects.toThrow(ForbiddenException);
    expect((await reload(inB)).status).toBe(DocStatus.DRAFT);
  });

  it('lets a COMPANY-scope holder withdraw any document of the company', async () => {
    const inB = await doc(ids.requester, ids.deptB);

    await as(ids.stranger, ids.deptA, Scope.COMPANY, () => submit.cancel(inB));

    expect((await reload(inB)).status).toBe(DocStatus.CANCELLED);
  });

  it('does not reach another company even at COMPANY scope', async () => {
    // Invariant 1 outranks the scope rule: the document read is company-scoped before scope runs.
    const inA = await doc(ids.requester, ids.deptA);

    await expect(
      as(ids.stranger, ids.otherDept, Scope.COMPANY, () => submit.cancel(inA), ids.otherCompany),
    ).rejects.toThrow();
    expect((await reload(inA)).status).toBe(DocStatus.DRAFT);
  });

  // ---- Scope decides WHO, never WHAT ---------------------------------------------------

  it('does not let any scope withdraw a completed document', async () => {
    const done = await doc(ids.requester, ids.deptA, DocStatus.COMPLETED);

    await expect(
      as(ids.stranger, ids.deptA, Scope.COMPANY, () => submit.cancel(done)),
    ).rejects.toThrow();
    expect((await reload(done)).status).toBe(DocStatus.COMPLETED);
  });

  it('stays a no-op on an already-withdrawn document', async () => {
    const mine = await doc(ids.requester, ids.deptA);
    await as(ids.requester, ids.deptA, Scope.OWN, () => submit.cancel(mine));

    await as(ids.procurement, ids.deptA, Scope.DEPARTMENT, () => submit.cancel(mine));

    expect(await cancelRows(mine)).toHaveLength(1);
  });

  // ---- A withdrawal still does everything a withdrawal did --------------------------------

  it('releases the budget a non-creator withdraws', async () => {
    // Invariant 5: reject/cancel ALWAYS releases. Who asked has no bearing on what happens.
    const mine = await doc(ids.requester, ids.deptA);
    await as(ids.requester, ids.deptA, Scope.OWN, () => submit.submit(mine));
    const reserved = await orm.em.fork().count(BudgetTxn, { document: mine, txnType: 'RESERVE' }, FILTER_OFF);
    expect(reserved).toBeGreaterThan(0);

    await as(ids.procurement, ids.deptA, Scope.DEPARTMENT, () => submit.cancel(mine));

    const released = await orm.em.fork().count(BudgetTxn, { document: mine, txnType: 'RELEASE' }, FILTER_OFF);
    expect(released).toBeGreaterThan(0);
    expect((await reload(mine)).status).toBe(DocStatus.CANCELLED);
  });

  it('writes no budget row when a draft is withdrawn', async () => {
    // A draft reserved nothing, so there is nothing to release and nothing to record.
    const mine = await doc(ids.requester, ids.deptA);

    await as(ids.procurement, ids.deptA, Scope.DEPARTMENT, () => submit.cancel(mine));

    expect(await orm.em.fork().count(BudgetTxn, { document: mine }, FILTER_OFF)).toBe(0);
  });

  it('writes one CANCEL row when two withdrawals race', async () => {
    // The row is locked PESSIMISTIC_WRITE before the scope check, so the loser finds CANCELLED and
    // returns through the no-op path rather than writing a second act.
    const mine = await doc(ids.requester, ids.deptA);

    await Promise.allSettled([
      as(ids.requester, ids.deptA, Scope.OWN, () => submit.cancel(mine)),
      as(ids.procurement, ids.deptA, Scope.DEPARTMENT, () => submit.cancel(mine)),
    ]);

    expect(await cancelRows(mine)).toHaveLength(1);
    expect((await reload(mine)).status).toBe(DocStatus.CANCELLED);
  });

  // ---- The detail answers the same question ----------------------------------------------

  it('tells the screen a non-creator within scope may withdraw', async () => {
    const swept = await doc(ids.requester, ids.deptB);

    const detail = await asViewing(ids.procurement, ids.deptB, Scope.DEPARTMENT, Scope.DEPARTMENT, () =>
      documents.detail(swept),
    );

    expect(detail.canCancel).toBe(true);
  });

  it('tells the screen a reader who may see but not withdraw', async () => {
    // The case the button must get right: visible, and refused. A reader who cannot SEE it never
    // reaches this question — the detail is not-found for them.
    const swept = await doc(ids.requester, ids.deptB);

    const detail = await asViewing(ids.stranger, ids.deptA, Scope.COMPANY, Scope.OWN, () =>
      documents.detail(swept),
    );

    expect(detail.canCancel).toBe(false);
  });

  it('tells the screen a completed document may not be withdrawn by anyone', async () => {
    const done = await doc(ids.requester, ids.deptA, DocStatus.COMPLETED);

    const detail = await asViewing(ids.stranger, ids.deptA, Scope.COMPANY, Scope.COMPANY, () =>
      documents.detail(done),
    );

    expect(detail.canCancel).toBe(false);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attachCoverage, budgetAt } from '../../test/budget-fixture';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ApproveAction, BudgetTxnType, ControlPolicy, DocCategory, DocStatus } from '../../common/enums';
import { fakeUpload } from '../../test/fake-upload';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { signAllUsers } from '../../test/signature-fixture';
import {
  ApprovalLog,
  DocumentApprovalStep,
  ROUTE_STEP_STATUS,
  Workflow,
} from '../approval/approval.entities';
import { AccountService } from '../accounting/account.service';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetService } from '../budget/budget.service';
import { BudgetTxn } from '../budget/budget.entities';
import { Currency, ExchangeRate } from '../currency/currency.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { ItemService } from '../master-data/item.service';
import { Item, ItemCompany } from '../master-data/master-data.entities';
import { TaxCode } from '../tax/tax.entities';
import { TaxKind } from '../../common/enums';
import { VendorService } from '../master-data/vendor.service';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { PaymentAttachmentService } from '../payment-handoff/payment-attachment.service';
import { Payment } from '../payment-handoff/payment.entities';
import { AppUser } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentRateService } from './document-rate.service';
import { DocumentSubmitService } from './document-submit.service';
import { DeptDocType, Document, DocumentLine, DocumentType, FormTemplate } from './document.entities';
import { DocumentService } from './document.service';
import { NumberingService } from './numbering.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;
const GLOBAL = { userId: '' };

/**
 * Restating a document's rate — the correction the person who converted the money makes, while the
 * document can still be refused.
 *
 * The business pays before the document finishes approving, so the figure stamped at submit is a
 * default, not the answer. These cover the narrow window in which it may be corrected, what follows
 * it (the budget hold, the audit trail), and every reason it may not.
 */
describe.skipIf(!hasDb)('restating a document rate (DB-backed)', () => {
  let orm: MikroORM;
  let documents: DocumentService;
  let submit: DocumentSubmitService;
  let rates: DocumentRateService;

  const ids = { company: '', dept: '', docType: '', budget: '', item: '', vat: '' };

  const asCtx = <T>(fn: () => Promise<T>): Promise<T> =>
    RequestContext.run(
      { userId: GLOBAL.userId, companyId: ids.company, departmentId: ids.dept, grants: [] },
      fn,
    );

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const usd = em.create(Currency, { code: 'USD', name: 'Dollar', decimalPlaces: 2, isActive: true });
    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const dept = em.create(Department, { company, deptCode: 'DA', name: 'DA', isActive: true });
    const y = new Date().getUTCFullYear();
    const fy = em.create(FiscalYear, { company, year: y, startDate: `${y}-01-01`, endDate: `${y}-12-31`, status: 'OPEN' });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    const user = em.create(AppUser, { username: 'finance', email: 'f@x', status: 'ACTIVE' });

    // A foreign-currency document is the only kind whose rate is worth restating.
    em.create(ExchangeRate, { fromCurrency: usd, toCurrency: thb, rate: '30', rateDate: `${y}-01-01`, rateType: 'DAILY' });

    const docType = em.create(DocumentType, { company, code: 'PR', name: 'PR', category: DocCategory.PROCUREMENT, requiresBudget: true, requiresQuota: false, isActive: true });
    const tmpl = em.create(FormTemplate, { documentType: docType, version: 1, status: 'PUBLISHED' });
    em.create(DeptDocType, { department: dept, documentType: docType, formTemplate: tmpl, workflow: wf, isActive: true });

    const budget = budgetAt(em, { fiscalYear: fy, department: dept, code: '5210', glAccount: '5210', budgetName: 'Utilities', amountTotal: '1000000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });
    attachCoverage(em, company, budget);
    const item = em.create(Item, { itemCode: 'ELEC', name: 'Electricity', isStockTracked: false, isActive: true });
    em.create(ItemCompany, { item, company, isActive: true, defaultGlAccount: '5210' });
    const vat = em.create(TaxCode, { company, code: 'VAT10', name: 'VAT 10%', kind: TaxKind.VAT, rate: '0.10', isActive: true });

    await em.flush();
    GLOBAL.userId = user.id;
    Object.assign(ids, {
      company: company.id, dept: dept.id, docType: docType.id, budget: budget.id, item: item.id,
      vat: vat.id,
    });
    // Submitting and approving need a signature on file; not this spec's subject, so everyone gets one.
    await signAllUsers(orm.em);
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
    const itemService = new ItemService(orm.em, scope, new ScopeService(), accounts);
    const fiscalYears = new FiscalYearService(scope);
    const ledger = new BudgetLedgerService(orm.em, new BudgetBalanceService(orm.em), new BudgetCoverageService(orm.em));
    documents = new DocumentService(
      orm.em, scope, new DeptDocTypeService(orm.em), new NumberingService(orm.em), itemService,
      new BudgetService(orm.em, accounts, new BudgetBalanceService(orm.em)), fiscalYears,
    );
    submit = new DocumentSubmitService(
      orm.em, new ExchangeRateService(orm.em), fiscalYears,
      new VendorService(orm.em, scope, new ScopeService()), itemService, ledger,
      new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em)),
    );
    rates = new DocumentRateService(orm.em, scope, new ExchangeRateService(orm.em), ledger);
  });

  const reload = (id: string) => orm.em.fork().findOneOrFail(Document, { id }, FILTER_OFF);
  const txns = (id: string) => orm.em.fork().find(BudgetTxn, { document: id }, { ...FILTER_OFF, orderBy: { createdAt: 'ASC' } });

  /**
   * A document mid-route: submitted, then put where a real one sits while people approve it —
   * one step decided, one still to decide. Built directly rather than by driving the approval
   * service, because what is under test is the state the rate service reads, not how it is reached.
   */
  async function inApproval(unitPrice = '100', budgetId = ids.budget, taxCodeId?: string): Promise<string> {
    const doc = await asCtx(async () => {
      const d = await documents.createDraft({
        documentTypeId: ids.docType,
        currency: 'USD',
        lines: [{ lineNo: 1, itemId: ids.item, description: 'Electricity', qty: '1', unitPrice, lineAmount: unitPrice, budgetId, taxCodeId }],
      });
      return submit.submit(d.id);
    });
    const em = orm.em.fork();
    const d = await em.findOneOrFail(Document, { id: doc.id }, FILTER_OFF);
    d.status = DocStatus.IN_APPROVAL;
    d.currentStepNo = 2;
    em.create(DocumentApprovalStep, { document: d, stepNo: 1, approverUser: em.getReference(AppUser, GLOBAL.userId), approveMode: 'SEQUENTIAL', status: ROUTE_STEP_STATUS.DONE, showSignatureOnPdf: false, requiresPaymentSlip: false } as never);
    em.create(DocumentApprovalStep, { document: d, stepNo: 2, approverUser: em.getReference(AppUser, GLOBAL.userId), approveMode: 'SEQUENTIAL', status: ROUTE_STEP_STATUS.PENDING, showSignatureOnPdf: false, requiresPaymentSlip: false } as never);
    await em.flush();
    return doc.id;
  }

  /**
   * A budget of its own, governed by its own control point.
   *
   * The shared fixture budget accumulates holds across this file, so a case that needs to reason
   * about how much room is left has to bring its own pot rather than depend on the order the tests
   * happened to run in.
   */
  async function freshBudget(amountTotal: string, code: string): Promise<string> {
    const em = orm.em.fork();
    const company = await em.findOneOrFail(Company, { id: ids.company }, FILTER_OFF);
    const dept = await em.findOneOrFail(Department, { id: ids.dept }, FILTER_OFF);
    const fy = await em.findOneOrFail(FiscalYear, { company: ids.company }, FILTER_OFF);
    const b = budgetAt(em, { fiscalYear: fy, department: dept, code, glAccount: code, budgetName: code, amountTotal, controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });
    attachCoverage(em, company, b);
    await em.flush();
    return b.id;
  }

  /** Mark every step decided — the state of a document nobody can refuse any more. */
  async function decideEveryStep(documentId: string): Promise<void> {
    const em = orm.em.fork();
    const steps = await em.find(DocumentApprovalStep, { document: documentId }, FILTER_OFF);
    for (const s of steps) s.status = ROUTE_STEP_STATUS.DONE;
    await em.flush();
  }

  // ---- What restating does ---------------------------------------------------

  it('restates the document at the rate the person states', async () => {
    const id = await inApproval('100'); // 100 USD @ 30 = 3,000 THB
    const before = await reload(id);
    expect(Number(before.baseTotalAmount)).toBe(3000);

    const result = await asCtx(() => rates.restate(id, '23'));
    expect(result.changed).toBe(true);
    expect(Number(result.from)).toBe(30);

    const after = await reload(id);
    expect(Number(after.exchangeRate)).toBe(23);
    expect(Number(after.baseTotalAmount)).toBe(2300);
    const [line] = await orm.em.fork().find(DocumentLine, { document: id }, FILTER_OFF);
    expect(Number(line.baseLineAmount)).toBe(2300);
  });

  it('moves the budget hold with it, as a RELEASE and a RESERVE', async () => {
    // Append-only (invariant 2): the history of a document that changed value is exactly the pair
    // of rows that show it changing. Nothing is updated and nothing is deleted.
    const id = await inApproval('100');
    expect((await txns(id)).map((t) => [t.txnType, Number(t.amount)])).toEqual([
      [BudgetTxnType.RESERVE, 3000],
    ]);

    await asCtx(() => rates.restate(id, '23'));

    expect((await txns(id)).map((t) => [t.txnType, Number(t.amount)])).toEqual([
      [BudgetTxnType.RESERVE, 3000],
      [BudgetTxnType.RELEASE, 3000],
      [BudgetTxnType.RESERVE, 2300],
    ]);
  });

  it('leaves the derived balance holding the new amount, not the old', async () => {
    const id = await inApproval('100');
    const balance = new BudgetBalanceService(orm.em);
    const before = await balance.availableBalance(ids.budget);

    await asCtx(() => rates.restate(id, '23'));

    // The pot gets 3,000 back and gives up 2,300, so it is 700 better off than it was.
    const after = await balance.availableBalance(ids.budget);
    expect(Number(after)).toBe(Number(before) + 700);
  });

  it('attributes the change in the append-only trail', async () => {
    const id = await inApproval('100');
    await asCtx(() => rates.restate(id, '23'));

    const [log] = await orm.em.fork().find(
      ApprovalLog,
      { document: id, action: ApproveAction.RESTATE_RATE },
      { ...FILTER_OFF, populate: ['approver'] },
    );
    expect(log).toBeDefined();
    expect(log.approver.id).toBe(GLOBAL.userId);
    // Both figures, so a reader can see what the document was worth on either side of it.
    expect(log.remark).toMatch(/30/);
    expect(log.remark).toMatch(/23/);
    expect(log.stepNo).toBe(2); // the step it was waiting on
  });

  it('does nothing at all when the stated rate is the one it already has', async () => {
    // A RELEASE/RESERVE pair and a log row recording a change of zero would be noise in two
    // append-only tables. The trail should carry what happened, not what was clicked.
    const id = await inApproval('100');
    const result = await asCtx(() => rates.restate(id, '30'));

    expect(result.changed).toBe(false);
    expect(await txns(id)).toHaveLength(1);
    expect(await orm.em.fork().count(ApprovalLog, { document: id }, FILTER_OFF)).toBe(0);
  });

  // ---- Which basis moves -----------------------------------------------------

  it('leaves the budget hold alone when a BUDGET_RATE governs it', async () => {
    // That rate type exists so daily FX does not whipsaw budget control or the approval bands that
    // read the same basis. Where one is configured, restating the daily rate must not move either.
    const em = orm.em.fork();
    const y = new Date().getUTCFullYear();
    const usd = await em.findOneOrFail(Currency, { code: 'USD' }, FILTER_OFF);
    const thb = await em.findOneOrFail(Currency, { code: 'THB' }, FILTER_OFF);
    em.create(ExchangeRate, { fromCurrency: usd, toCurrency: thb, rate: '30', rateDate: `${y}-01-01`, rateType: 'BUDGET_RATE' });
    await em.flush();

    try {
      const id = await inApproval('100');
      const result = await asCtx(() => rates.restate(id, '23'));

      expect(result.budgetReReserved).toBe(false);
      // The document's own worth moved; the hold did not.
      const after = await reload(id);
      expect(Number(after.baseTotalAmount)).toBe(2300);
      expect(Number(after.budgetBaseTotalAmount)).toBe(3000);
      expect((await txns(id)).map((t) => t.txnType)).toEqual([BudgetTxnType.RESERVE]);
    } finally {
      const cleanup = orm.em.fork();
      const row = await cleanup.findOne(ExchangeRate, { rateType: 'BUDGET_RATE' }, FILTER_OFF);
      if (row) await cleanup.removeAndFlush(row);
    }
  });

  // ---- Every reason it is refused --------------------------------------------

  it('refuses a rate that is not positive, and writes nothing', async () => {
    const id = await inApproval('100');
    await expect(asCtx(() => rates.restate(id, '0'))).rejects.toThrow(/positive/i);
    expect(await txns(id)).toHaveLength(1);
  });

  it('refuses a document that is not in approval, naming its status', async () => {
    const id = await inApproval('100');
    const em = orm.em.fork();
    const d = await em.findOneOrFail(Document, { id }, FILTER_OFF);
    d.status = DocStatus.COMPLETED;
    await em.flush();

    await expect(asCtx(() => rates.restate(id, '23'))).rejects.toThrow(/COMPLETED/);
    expect(Number((await reload(id)).exchangeRate)).toBe(30);
  });

  it('refuses a document with no approval step left to decide', async () => {
    // The whole safety of this operation: somebody must still be able to say no to the new figure.
    const id = await inApproval('100');
    await decideEveryStep(id);

    await expect(asCtx(() => rates.restate(id, '23'))).rejects.toThrow(/no approval step left/i);
    expect(await txns(id)).toHaveLength(1);
  });

  it('refuses a document whose payment is already recorded', async () => {
    const id = await inApproval('100');
    const em = orm.em.fork();
    em.create(Payment, {
      company: em.getReference(Company, ids.company),
      document: em.getReference(Document, id),
      lockedRate: '30', actualRate: '30', baseLocked: '3000', baseActual: '3000',
      fxDelta: '0', fxKind: 'NONE', whtAmount: '0', paidAt: new Date(), createdAt: new Date(),
    } as never);
    await em.flush();

    await expect(asCtx(() => rates.restate(id, '23'))).rejects.toThrow(/recorded payment/i);
    expect(Number((await reload(id)).exchangeRate)).toBe(30);
  });

  it('refuses a restatement that would breach the ceiling, keeping the original hold', async () => {
    // The refusal comes from `reserve`, which is the code that refuses an over-budget submit — the
    // same rule, not a copy. It rolls the whole transaction back, so the release goes with it.
    const id = await inApproval('30000'); // 30,000 USD @ 30 = 900,000 of a 1,000,000 budget
    const before = (await txns(id)).map((t) => [t.txnType, Number(t.amount)]);
    expect(before).toEqual([[BudgetTxnType.RESERVE, 900000]]);

    // At 40 the same purchase wants 1,200,000, which the budget cannot cover.
    await expect(asCtx(() => rates.restate(id, '40'))).rejects.toThrow();

    // Neither the release nor the new reserve survived, and the document is unchanged.
    expect((await txns(id)).map((t) => [t.txnType, Number(t.amount)])).toEqual(before);
    expect(Number((await reload(id)).exchangeRate)).toBe(30);
  });

  it('re-reserves a taxed document on the same basis a fresh submit would', async () => {
    // Two paths to one document must not give two answers: restating re-converts the amounts submit
    // stamped, tax included, so a document corrected to a rate reserves what an identical document
    // submitted at that rate reserves.
    const restated = await inApproval('100', ids.budget, ids.vat); // 100 + 10 VAT
    expect(Number(await new BudgetBalanceService(orm.em).outstandingReserved(restated, ids.budget))).toBe(3300);

    await asCtx(() => rates.restate(restated, '23'));
    const afterRestate = Number(
      await new BudgetBalanceService(orm.em).outstandingReserved(restated, ids.budget),
    );
    expect(afterRestate).toBe(2530); // 110 × 23

    const doc = await reload(restated);
    expect(Number(doc.budgetBaseTotalAmount)).toBe(2530);
    expect(Number(doc.baseTotalAmount)).toBe(2530); // both bases tax-inclusive, differing only by rate
  });

  // ---- Both ways in reach the same operation ---------------------------------

  it('restates from a slip upload, and from the rate alone, identically', async () => {
    // Two entries, one implementation: a correction made without a file and one made with a file
    // must not come to mean different things.
    const storage = {
      buildKey: (id: string, name: string) => `payments/${id}/${name}`,
      putObject: async () => undefined,
      presignDownload: async () => 'https://signed.example/x',
      deleteObject: async () => undefined,
    };
    const slips = new PaymentAttachmentService(
      orm.em,
      new CompanyScopeService(orm.em),
      storage as never,
      rates,
    );

    const viaSlip = await inApproval('100');
    await asCtx(() =>
      slips.upload(viaSlip, fakeUpload('slip.png', 'image/png', 1) as never, 'PRIMARY', '23'),
    );
    expect(Number((await reload(viaSlip)).exchangeRate)).toBe(23);

    const viaRate = await inApproval('100');
    await asCtx(() => slips.stateRate(viaRate, '23'));
    expect(Number((await reload(viaRate)).exchangeRate)).toBe(23);

    // Same document worth, same ledger shape.
    expect(Number((await reload(viaSlip)).baseTotalAmount)).toBe(
      Number((await reload(viaRate)).baseTotalAmount),
    );
    expect((await txns(viaSlip)).map((t) => t.txnType)).toEqual(
      (await txns(viaRate)).map((t) => t.txnType),
    );
  });

  it('keeps a slip that was attached to a document whose rate cannot be restated', async () => {
    // Evidence for a paid or finished document is still evidence. A refusal to restate must not
    // lose the file — only `stateRate`, whose whole point is the restatement, refuses loudly.
    const storage = {
      buildKey: (id: string, name: string) => `payments/${id}/${name}`,
      putObject: async () => undefined,
      presignDownload: async () => 'https://signed.example/x',
      deleteObject: async () => undefined,
    };
    const slips = new PaymentAttachmentService(
      orm.em, new CompanyScopeService(orm.em), storage as never, rates,
    );
    const id = await inApproval('100');
    await decideEveryStep(id);

    await asCtx(() => slips.upload(id, fakeUpload('late.png', 'image/png', 1) as never, 'PRIMARY', '23'));

    expect(await asCtx(() => slips.list(id))).toHaveLength(1);
    expect(Number((await reload(id)).exchangeRate)).toBe(30); // unchanged, as refused
    await expect(asCtx(() => slips.stateRate(id, '23'))).rejects.toThrow(/no approval step left/i);
  });

  // ---- Concurrency -----------------------------------------------------------

  it('serialises two restatements against one budget with room for one', async () => {
    // Restating reads a balance and writes against it, which is the shape that over-commits when
    // two interleave. The control-point lock the release takes is held to commit, so the second
    // waits for the first and then fails its own ceiling check.
    //
    // Its own pot, sized so exactly one of the two increases fits: 1,000 each at rate 30 = 30,000
    // held apiece, and 70,000 spare. Tripling one to 90,000 consumes 60,000 of it; tripling both
    // would need 120,000.
    const pot = await freshBudget('160000', '5299');
    const a = await inApproval('1000', pot);
    const b = await inApproval('1000', pot);
    const balance = new BudgetBalanceService(orm.em);
    expect(Number(await balance.availableBalance(pot))).toBe(100000);

    const results = await Promise.allSettled([
      asCtx(() => rates.restate(a, '90')),
      asCtx(() => rates.restate(b, '90')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    // The pot was never over-committed: one document holds 90,000 and the other still holds 30,000.
    const after = Number(await balance.availableBalance(pot));
    expect(after).toBe(160000 - 90000 - 30000);
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[document-rate-restate] no database reachable — skipping DB-backed spec');
}

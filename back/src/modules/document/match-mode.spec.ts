import { EntityManager } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attachCoverage, budgetAt } from '../../test/budget-fixture';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { BudgetTxnType, ControlPolicy, DocCategory, DocStatus } from '../../common/enums';
import { signAllUsers } from '../../test/signature-fixture';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { AccountService } from '../accounting/account.service';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { BudgetService } from '../budget/budget.service';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { ItemService } from '../master-data/item.service';
import { VendorService } from '../master-data/vendor.service';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { AppUser } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentSubmitService } from './document-submit.service';
import { DocumentTypeService } from './document-type.service';
import {
  DeptDocType,
  Document,
  DocumentCategory,
  DocumentLine,
  DocumentType,
  DocumentTypeRef,
  FormTemplate,
} from './document.entities';
import { DocumentService } from './document.service';
import { MatchingService } from './matching.service';
import { NumberingService } from './numbering.service';
import { ReceivingService } from './receiving.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Matching and receiving are type configuration. The old rule — every CUT_BUDGET document with a
 * predecessor is three-way matched — held a PO that closes its chain against a PR that had bought
 * nothing, and made services receive what cannot arrive. `match_mode` says per type; the default
 * is the old behaviour. `receives_goods` says which types take receipts at all.
 */
describe.skipIf(!hasDb)('match_mode and receives_goods (DB-backed)', () => {
  let orm: MikroORM;
  let documents: DocumentService;
  let submit: DocumentSubmitService;
  let types: DocumentTypeService;
  const ids = {
    company: '', dept: '', user: '', wf: '', budget: '',
    poThree: '', poTwo: '', poNone: '', disbThree: '', disbTwo: '', proc: '', poCloses: '',
    tmpl: {} as Record<string, string>,
  };
  let seq = 0;

  const asUser = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: ids.user, companyId: ids.company, departmentId: ids.dept, grants: [] }, fn);

  /** A document of a type with one line, written directly. */
  async function doc(
    typeId: string, status: DocStatus,
    line: { qty: string; lineAmount: string; receivedQty?: string; budgetId?: string },
    refDocumentId?: string,
  ): Promise<string> {
    const em = orm.em.fork();
    const d = em.create(Document, {
      docNo: `D-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, typeId),
      formTemplate: em.getReference(FormTemplate, ids.tmpl[typeId]),
      workflow: em.getReference(Workflow, ids.wf),
      createdBy: em.getReference(AppUser, ids.user),
      refDocument: refDocumentId ? em.getReference(Document, refDocumentId) : undefined,
      exchangeRate: '1',
      status,
      createdAt: new Date(),
    });
    em.create(DocumentLine, {
      document: d, lineNo: 1, description: 'Widget', qty: line.qty, unitPrice: '10',
      lineAmount: line.lineAmount, receivedQty: line.receivedQty ?? '0',
      budget: line.budgetId ? em.getReference(Budget, line.budgetId) : undefined,
    });
    await em.flush();
    return d.id;
  }

  const matching = () => new MatchingService(orm.em, new CompanyScopeService(orm.em));

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const lak = em.create(Currency, { code: 'LAK', name: 'Kip', decimalPlaces: 0, isActive: true });
    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: lak, isActive: true });
    const dept = em.create(Department, { company, deptCode: 'DA', name: 'DA', isActive: true });
    const y = new Date().getUTCFullYear();
    const fy = em.create(FiscalYear, { company, year: y, startDate: `${y}-01-01`, endDate: `${y}-12-31`, status: 'OPEN' });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    const user = em.create(AppUser, { username: 'buyer', email: 'buyer@x', status: 'ACTIVE' });
    em.create(DocumentCategory, { company, code: DocCategory.PROCUREMENT, name: 'Procurement', isActive: true });
    const budget = budgetAt(em, { fiscalYear: fy, department: dept, code: '5000', glAccount: '5000', budgetName: 'Office', amountTotal: '1000000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });
    attachCoverage(em, company, budget);

    const mk = (code: string, extra: Partial<DocumentType>) => {
      const t = em.create(DocumentType, { company, code, name: code, category: DocCategory.PROCUREMENT, requiresBudget: false, requiresQuota: false, isActive: true, ...extra });
      const tmpl = em.create(FormTemplate, { documentType: t, version: 1, status: 'PUBLISHED' });
      em.create(DeptDocType, { department: dept, documentType: t, formTemplate: tmpl, workflow: wf, isActive: true });
      return { t, tmpl };
    };
    // Predecessors that receive goods, and settlement types in each mode.
    const poThree = mk('PO3', { receivesGoods: true });
    const disbThree = mk('DISB3', { postAction: 'CUT_BUDGET' }); // default THREE_WAY
    const disbTwo = mk('DISB2', { postAction: 'CUT_BUDGET', matchMode: 'TWO_WAY' });
    // The customer's shape: PR without prices → PO that pays, checked against nothing.
    const proc = mk('PR', { requiresBudget: true, postAction: 'CREATE_SUCCESSOR' });
    const poCloses = mk('PO', { requiresBudget: true, postAction: 'CUT_BUDGET', matchMode: 'NONE' });
    em.create(DocumentTypeRef, { company, predecessorType: proc.t, successorType: poCloses.t, autoCreate: false });
    await em.flush();

    Object.assign(ids, {
      company: company.id, dept: dept.id, user: user.id, wf: wf.id, budget: budget.id,
      poThree: poThree.t.id, disbThree: disbThree.t.id, disbTwo: disbTwo.t.id, proc: proc.t.id, poCloses: poCloses.t.id,
      tmpl: Object.fromEntries([poThree, disbThree, disbTwo, proc, poCloses].map(({ t, tmpl }) => [t.id, tmpl.id])),
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
    const itemService = new ItemService(orm.em, scope, new ScopeService(), new AccountService(orm.em, scope));
    const vendorService = new VendorService(orm.em, scope, new ScopeService());
    const budgetService = new BudgetService(orm.em, new AccountService(orm.em, scope), new BudgetBalanceService(orm.em));
    const fiscalYears = new FiscalYearService(scope);
    const ledger = new BudgetLedgerService(orm.em, new BudgetBalanceService(orm.em), new BudgetCoverageService(orm.em));
    documents = new DocumentService(orm.em, scope, new DeptDocTypeService(orm.em), new NumberingService(orm.em), itemService, budgetService, fiscalYears);
    submit = new DocumentSubmitService(
      orm.em, new ExchangeRateService(orm.em), fiscalYears, vendorService, itemService, ledger,
      new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em)),
      matching(),
    );
    types = new DocumentTypeService(orm.em);
  });

  // ---- The default is the old behaviour ---------------------------------------

  it('THREE_WAY (the default) blocks an invoice beyond what was received', async () => {
    const po = await doc(ids.poThree, DocStatus.COMPLETED, { qty: '10', lineAmount: '100', receivedQty: '4' });
    const disb = await doc(ids.disbThree, DocStatus.DRAFT, { qty: '6', lineAmount: '60' }, po);

    const result = await asUser(() => matching().match(disb));
    expect(result.ok).toBe(false);
    expect(result.lines[0].reason).toMatch(/exceeds received/);
    await expect(asUser(() => matching().assertMatched(disb))).rejects.toThrow(/matching failed/);
  });

  // ---- TWO_WAY ---------------------------------------------------------------

  it('TWO_WAY passes with nothing received', async () => {
    const po = await doc(ids.poThree, DocStatus.COMPLETED, { qty: '10', lineAmount: '100', receivedQty: '0' });
    const disb = await doc(ids.disbTwo, DocStatus.DRAFT, { qty: '10', lineAmount: '100' }, po);

    const result = await asUser(() => matching().match(disb));
    expect(result.ok).toBe(true);
    // Still reported, so the panel can show what did (not) arrive.
    expect(result.lines[0].receivedQty).toBe('0.0000');
  });

  it('TWO_WAY still refuses an invoice above the ordered amount', async () => {
    const po = await doc(ids.poThree, DocStatus.COMPLETED, { qty: '10', lineAmount: '100' });
    const disb = await doc(ids.disbTwo, DocStatus.DRAFT, { qty: '10', lineAmount: '120' }, po);

    const result = await asUser(() => matching().match(disb));
    expect(result.ok).toBe(false);
    expect(result.lines[0].reason).toMatch(/exceeds ordered/);
  });

  // ---- NONE -------------------------------------------------------------------

  it('NONE matches nothing and reports no lines', async () => {
    const pr = await doc(ids.proc, DocStatus.COMPLETED, { qty: '3', lineAmount: '0' });
    const po = await doc(ids.poCloses, DocStatus.DRAFT, { qty: '3', lineAmount: '204000' }, pr);

    expect(await asUser(() => matching().match(po))).toEqual({ ok: true, lines: [] });
  });

  it('a PO that closes the chain submits from an unpriced, unreceived PR and reserves its own budget', async () => {
    // The PR asked for 3 of something with no price: nothing reserved, nothing received.
    const pr = await doc(ids.proc, DocStatus.COMPLETED, { qty: '3', lineAmount: '0' });

    const poId = await asUser(async () => {
      const po = await documents.createFrom(pr, ids.poCloses);
      await documents.setLines(po.id, [
        { lineNo: 1, description: 'Water', qty: '3', unitPrice: '68000', lineAmount: '204000', budgetId: ids.budget },
      ]);
      await submit.submit(po.id);
      return po.id;
    });

    const po = await orm.em.fork().findOneOrFail(Document, { id: poId }, FILTER_OFF);
    expect(po.status).toBe(DocStatus.SUBMITTED);
    const reserves = (await orm.em.fork().find(BudgetTxn, { document: poId }, FILTER_OFF)).filter((t) => t.txnType === BudgetTxnType.RESERVE);
    expect(reserves).toHaveLength(1);
    expect(Number(reserves[0].amount)).toBe(204000);
  });

  // ---- Receiving ---------------------------------------------------------------

  it('a type that does not receive goods refuses a receipt, naming itself', async () => {
    const pr = await doc(ids.proc, DocStatus.COMPLETED, { qty: '3', lineAmount: '0' });
    const lineId = (await orm.em.fork().findOneOrFail(DocumentLine, { document: pr }, FILTER_OFF)).id;
    const receiving = new ReceivingService(new CompanyScopeService(orm.em));

    await expect(asUser(() => receiving.receive(pr, { lines: [{ lineId, qty: '3' }] }))).rejects.toThrow(
      /Document type PR does not receive goods/,
    );
    const line = await orm.em.fork().findOneOrFail(DocumentLine, { id: lineId }, FILTER_OFF);
    expect(line.receivedQty).toBe('0.0000');
  });

  it('a receiving type takes the receipt', async () => {
    const po = await doc(ids.poThree, DocStatus.COMPLETED, { qty: '3', lineAmount: '100' });
    const lineId = (await orm.em.fork().findOneOrFail(DocumentLine, { document: po }, FILTER_OFF)).id;
    const receiving = new ReceivingService(new CompanyScopeService(orm.em));

    const [view] = await asUser(() => receiving.receive(po, { lines: [{ lineId, qty: '3' }] }));
    expect(view.lineStatus).toBe('RECEIVED');
  });

  // ---- Type configuration -------------------------------------------------------

  it('defaults to THREE_WAY and no receipts; round-trips both settings; refuses an unknown mode', async () => {
    const created = await asUser(() => types.create({ code: 'SVC', name: 'Service', category: DocCategory.PROCUREMENT } as never));
    expect(created.matchMode).toBe('THREE_WAY');
    expect(created.receivesGoods).toBe(false);

    const updated = await asUser(() => types.update(created.id, { matchMode: 'TWO_WAY', receivesGoods: true } as never));
    expect(updated.matchMode).toBe('TWO_WAY');
    expect(updated.receivesGoods).toBe(true);

    // The DTO's @IsIn refuses it at the HTTP boundary; the CHECK constraint refuses it here.
    await expect(asUser(() => types.update(created.id, { matchMode: 'FOUR_WAY' } as never))).rejects.toThrow();
  });
});

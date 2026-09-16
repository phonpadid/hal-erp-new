import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attachCoverage, budgetAt } from '../../test/budget-fixture';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ControlPolicy, DocCategory } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { signAllUsers } from '../../test/signature-fixture';
import { Workflow } from '../approval/approval.entities';
import { AccountService } from '../accounting/account.service';
import { BudgetService } from '../budget/budget.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { ItemService } from '../master-data/item.service';
import { VendorService } from '../master-data/vendor.service';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { AppUser } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { CreateDocumentDto } from './dto/document.dto';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DeptDocType, Document, DocumentType, FormTemplate, DocRunningNumber } from './document.entities';
import { DocumentService } from './document.service';
import { DocumentSubmitService } from './document-submit.service';
import { NumberingService } from './numbering.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

const GLOBAL = { userId: '' };
function asCtx<T>(companyId: string, departmentId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run({ userId: GLOBAL.userId, companyId, departmentId, grants: [] }, fn);
}

/**
 * Creating a document twice for one external source.
 *
 * An external system creates documents over HTTP, and HTTP retries. Without a key naming where a
 * document came from, a retry after a timeout is indistinguishable from a second claim — and since
 * such a document is submitted as soon as it is created, the duplicate reserves the budget again.
 * `budget_txn` is append-only, so that reservation cannot be deleted, only answered with a
 * compensating RELEASE by whoever notices. These tests are about that not happening.
 */
describe.skipIf(!hasDb)('idempotent creation from an external source (DB-backed)', () => {
  let orm: MikroORM;
  let documents: DocumentService;
  let submit: DocumentSubmitService;

  const ids = { companyA: '', deptA: '', companyB: '', deptB: '', dtA: '', dtB: '', budgetA: '' };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const y = new Date().getUTCFullYear();
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });

    // Two companies, because the key is scoped by company and that has to be proved, not assumed.
    const mk = (code: string) => {
      const company = em.create(Company, { code, nameTh: code, taxId: code, branchCode: '00000', baseCurrency: thb, isActive: true });
      const dept = em.create(Department, { company, deptCode: `D${code}`, name: `D${code}`, isActive: true });
      const fy = em.create(FiscalYear, { company, year: y, startDate: `${y}-01-01`, endDate: `${y}-12-31`, status: 'OPEN' });
      const wf = em.create(Workflow, { company, name: `WF${code}`, isActive: true });
      const dt = em.create(DocumentType, {
        company, code: 'CLAIM', name: 'Claim', category: DocCategory.FINANCE,
        requiresBudget: true, requiresQuota: false, defaultGlAccount: '5210', isActive: true,
      });
      const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
      em.create(DeptDocType, { department: dept, documentType: dt, formTemplate: tmpl, workflow: wf, isActive: true });
      const budget = budgetAt(em, {
        fiscalYear: fy, department: dept, code: '5210', glAccount: '5210', budgetName: 'Claims',
        amountTotal: '1000000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE',
      });
      attachCoverage(em, company, budget);
      return { company, dept, dt, budget };
    };
    const a = mk('A');
    const b = mk('B');

    await em.flush();
    GLOBAL.userId = user.id;
    Object.assign(ids, {
      companyA: a.company.id, deptA: a.dept.id, dtA: a.dt.id, budgetA: a.budget.id,
      companyB: b.company.id, deptB: b.dept.id, dtB: b.dt.id,
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
    documents = new DocumentService(orm.em, scope, new DeptDocTypeService(orm.em), new NumberingService(orm.em), itemService, budgetService, fiscalYears);
    submit = new DocumentSubmitService(
      orm.em,
      new ExchangeRateService(orm.em),
      fiscalYears,
      vendorService,
      itemService,
      new BudgetLedgerService(orm.em, new BudgetBalanceService(orm.em), new BudgetCoverageService(orm.em)),
      new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em)),
    );
  });

  const docsForSource = (sourceId: string) =>
    orm.em.fork().find(Document, { sourceType: 'CLAIM', sourceId }, FILTER_OFF);
  const runningNo = async (companyId: string, documentTypeId: string) =>
    (await orm.em.fork().findOne(DocRunningNumber, { company: companyId, documentType: documentTypeId }, FILTER_OFF))
      ?.currentNo ?? null;

  it('returns the same document when the same source is created twice', async () => {
    const dto = { documentTypeId: ids.dtA, sourceType: 'CLAIM', sourceId: 'CLM-B-0001', totalAmount: '4500.00' };
    const first = await asCtx(ids.companyA, ids.deptA, () => documents.createDraft(dto));
    const second = await asCtx(ids.companyA, ids.deptA, () => documents.createDraft(dto));

    expect(second.id).toBe(first.id);
    expect(await docsForSource('CLM-B-0001')).toHaveLength(1);
  });

  it('consumes no document number on the retry', async () => {
    const dto = { documentTypeId: ids.dtA, sourceType: 'CLAIM', sourceId: 'CLM-B-0002' };
    await asCtx(ids.companyA, ids.deptA, () => documents.createDraft(dto));
    const after1 = await runningNo(ids.companyA, ids.dtA);

    await asCtx(ids.companyA, ids.deptA, () => documents.createDraft(dto));
    const after2 = await runningNo(ids.companyA, ids.dtA);

    // The counter is committed in its own transaction, so a number spent here is a number lost.
    expect(after2).toBe(after1);
  });

  it('ignores a differing payload and returns the stored document unchanged', async () => {
    const first = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({ documentTypeId: ids.dtA, sourceType: 'CLAIM', sourceId: 'CLM-B-0003', totalAmount: '4500.00' }),
    );
    const second = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({ documentTypeId: ids.dtA, sourceType: 'CLAIM', sourceId: 'CLM-B-0003', totalAmount: '999999.00' }),
    );

    expect(second.id).toBe(first.id);
    // A retry is the same request; a different amount means misuse, and quietly rewriting a
    // document that may already be approved would be worse than ignoring the input.
    const stored = await orm.em.fork().findOneOrFail(Document, { id: first.id }, FILTER_OFF);
    expect(stored.totalAmount).toBe('4500.00');
  });

  it('treats the same source id in another company as a different document', async () => {
    const inA = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({ documentTypeId: ids.dtA, sourceType: 'CLAIM', sourceId: 'CLM-SHARED' }),
    );
    const inB = await asCtx(ids.companyB, ids.deptB, () =>
      documents.createDraft({ documentTypeId: ids.dtB, sourceType: 'CLAIM', sourceId: 'CLM-SHARED' }),
    );

    expect(inB.id).not.toBe(inA.id);
    expect(await docsForSource('CLM-SHARED')).toHaveLength(2);
  });

  it('creates normally when no source is supplied', async () => {
    const one = await asCtx(ids.companyA, ids.deptA, () => documents.createDraft({ documentTypeId: ids.dtA }));
    const two = await asCtx(ids.companyA, ids.deptA, () => documents.createDraft({ documentTypeId: ids.dtA }));

    // The web-app path is unchanged: two creates are two documents.
    expect(two.id).not.toBe(one.id);
    expect(one.sourceType).toBeUndefined();
  });

  it('creates exactly one document when two retries race', async () => {
    const dto = { documentTypeId: ids.dtA, sourceType: 'CLAIM', sourceId: 'CLM-B-RACE' };
    const [a, b] = await Promise.all([
      asCtx(ids.companyA, ids.deptA, () => documents.createDraft(dto)),
      asCtx(ids.companyA, ids.deptA, () => documents.createDraft(dto)),
    ]);

    // Both callers asked for the same thing and both must get it — the loser of the unique index
    // re-reads rather than failing.
    expect(await docsForSource('CLM-B-RACE')).toHaveLength(1);
    expect(a.id).toBe(b.id);
  });

  it('does not reserve the budget twice when a submitted document is re-created', async () => {
    // A budget-controlled type needs a budgeted line to submit, and the line says which budget:
    // the type's default GL stamps the account only.
    const dto = {
      documentTypeId: ids.dtA, sourceType: 'CLAIM', sourceId: 'CLM-B-0004', totalAmount: '4500.00',
      lines: [{ lineNo: 1, description: 'ค่าชดเชยพัสดุเสียหาย', qty: '1', unitPrice: '4500', lineAmount: '4500', budgetId: ids.budgetA }],
    };
    const doc = await asCtx(ids.companyA, ids.deptA, () => documents.createDraft(dto));
    await asCtx(ids.companyA, ids.deptA, () => submit.submit(doc.id));

    const before = await orm.em.fork().count(BudgetTxn, { document: doc.id }, FILTER_OFF);
    const retry = await asCtx(ids.companyA, ids.deptA, () => documents.createDraft(dto));

    expect(retry.id).toBe(doc.id);
    // The whole point: an append-only ledger cannot un-reserve, so the duplicate must never exist.
    expect(await orm.em.fork().count(BudgetTxn, { document: doc.id }, FILTER_OFF)).toBe(before);
    expect(await docsForSource('CLM-B-0004')).toHaveLength(1);
  });
});

/** The pair rule lives in the DTO, so it is provable without a database. */
describe('CreateDocumentDto external source pair', () => {
  const dto = (over: Partial<CreateDocumentDto>) =>
    plainToInstance(CreateDocumentDto, { documentTypeId: '11111111-1111-4111-8111-111111111111', ...over });

  it('accepts both together', async () => {
    expect(await validate(dto({ sourceType: 'CLAIM', sourceId: 'X-1' }))).toHaveLength(0);
  });

  it('accepts neither', async () => {
    expect(await validate(dto({}))).toHaveLength(0);
  });

  it('rejects a source type without an id', async () => {
    const errors = await validate(dto({ sourceType: 'CLAIM' }));
    expect(errors.map((e) => e.property)).toContain('sourceId');
  });

  it('rejects an id without a source type', async () => {
    const errors = await validate(dto({ sourceId: 'X-1' }));
    expect(errors.map((e) => e.property)).toContain('sourceType');
  });
});

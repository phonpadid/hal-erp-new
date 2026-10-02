import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { attachCoverage, budgetAt } from '../../test/budget-fixture';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ControlPolicy, DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { signAllUsers } from '../../test/signature-fixture';
import { AccountService } from '../accounting/account.service';
import { Workflow } from '../approval/approval.entities';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetService } from '../budget/budget.service';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { ItemService } from '../master-data/item.service';
import { VendorService } from '../master-data/vendor.service';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import { AppUser } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentSubmitService } from './document-submit.service';
import { DocumentService } from './document.service';
import { DeptDocType, DocRunningNumber, Document, DocumentLine, DocumentType, FormTemplate } from './document.entities';
import { NumberingService } from './numbering.service';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * A budget document is started only inside a year someone has budgeted, numbered by the company's
 * own year, offered only that year's budgets, and refused at submit when a line still names last
 * year's — unless its predecessor already charged it. Documents that use no budget are untouched.
 */
describe.skipIf(!hasDb)('document-engine: the fiscal year a budget document lives in (DB-backed)', () => {
  let orm: MikroORM;
  let documents: DocumentService;
  let budgets: BudgetService;
  let submit: DocumentSubmitService;
  const ids = { company: '', dept: '', user: '', pr: '', memo: '', prTmpl: '', wf: '', fy2026: '', b2026: '', fy2027: '', b2027: '' };
  let seq = 0;

  const asCtx = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: ids.user, companyId: ids.company, departmentId: ids.dept, grants: [] }, fn);
  /** Moves only `Date`, so the clock reads the day under test while the driver's timers run. */
  const onDay = (iso: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso));
  };
  afterEach(() => vi.useRealTimers());

  const lines = (budgetId: string) => [{ lineNo: 1, description: 'Paper', qty: '1', unitPrice: '100', lineAmount: '100', budgetId }];

  async function draftCharging(budgetId: string, refDocumentId?: string): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `T-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, ids.pr),
      formTemplate: em.getReference(FormTemplate, ids.prTmpl),
      workflow: em.getReference(Workflow, ids.wf),
      createdBy: em.getReference(AppUser, ids.user),
      currency: em.getReference(Currency, 'LAK'),
      totalAmount: '100',
      status: DocStatus.DRAFT,
      createdAt: new Date(),
      refDocument: refDocumentId ? em.getReference(Document, refDocumentId) : undefined,
    });
    em.create(DocumentLine, { document: doc, lineNo: 1, description: 'X', qty: '1', unitPrice: '100', lineAmount: '100', budget: em.getReference(Budget, budgetId) });
    await em.flush();
    return doc.id;
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const lak = em.create(Currency, { code: 'LAK', name: 'Kip', decimalPlaces: 0, isActive: true });
    const company = em.create(Company, { code: 'HAL', nameTh: 'HAL', taxId: '1', branchCode: '00000', baseCurrency: lak, timezone: 'Asia/Vientiane', isActive: true });
    const dept = em.create(Department, { company, deptCode: 'D', name: 'D', isActive: true });
    const fy2026 = em.create(FiscalYear, { company, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });
    const pr = em.create(DocumentType, { company, code: 'PR', name: 'PR', category: DocCategory.PROCUREMENT, requiresBudget: true, requiresQuota: false, postAction: 'CUT_BUDGET', isActive: true });
    const memo = em.create(DocumentType, { company, code: 'MEMO', name: 'Memo', category: DocCategory.ADMIN, requiresBudget: false, requiresQuota: false, isActive: true });
    const prTmpl = em.create(FormTemplate, { documentType: pr, version: 1, status: 'PUBLISHED' });
    const memoTmpl = em.create(FormTemplate, { documentType: memo, version: 1, status: 'PUBLISHED' });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    em.create(DeptDocType, { department: dept, documentType: pr, formTemplate: prTmpl, workflow: wf, isActive: true });
    em.create(DeptDocType, { department: dept, documentType: memo, formTemplate: memoTmpl, workflow: wf, isActive: true });
    const b2026 = budgetAt(em, { fiscalYear: fy2026, department: dept, code: '6.101', glAccount: '612.06', amountTotal: '1000000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });
    attachCoverage(em, company, b2026);
    await em.flush();
    Object.assign(ids, { company: company.id, dept: dept.id, user: user.id, pr: pr.id, memo: memo.id, prTmpl: prTmpl.id, wf: wf.id, fy2026: fy2026.id, b2026: b2026.id });
    await signAllUsers(orm.em);

    const scope = new CompanyScopeService(orm.em as EntityManager);
    const accounts = new AccountService(orm.em, scope);
    const fiscalYears = new FiscalYearService(scope);
    budgets = new BudgetService(orm.em, accounts, new BudgetBalanceService(orm.em));
    documents = new DocumentService(
      orm.em,
      scope,
      new DeptDocTypeService(orm.em),
      new NumberingService(orm.em),
      new ItemService(orm.em, scope, new ScopeService(), accounts),
      budgets,
      fiscalYears,
    );
    const balance = new BudgetBalanceService(orm.em);
    submit = new DocumentSubmitService(
      orm.em,
      new ExchangeRateService(orm.em),
      fiscalYears,
      new VendorService(orm.em, scope, new ScopeService()),
      new ItemService(orm.em, scope, new ScopeService(), accounts),
      new BudgetLedgerService(orm.em, balance, new BudgetCoverageService(orm.em)),
      new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em)),
    );
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  describe('inside a budgeted year', () => {
    it('creates a budget document numbered in that year', async () => {
      onDay('2026-06-01T03:00:00Z');
      const doc = await asCtx(() => documents.createDraft({ documentTypeId: ids.pr, lines: lines(ids.b2026) } as never));
      expect(doc.docNo).toContain('-2026-');
    });

    it('offers no type as blocked', async () => {
      onDay('2026-06-01T03:00:00Z');
      const types = await asCtx(() => documents.listCreatableTypes());
      expect(types.every((t) => !t.blocked)).toBe(true);
    });
  });

  describe('the year turned and nobody prepared it', () => {
    it('refuses a budget document before spending a number', async () => {
      onDay('2027-01-02T03:00:00Z');
      await expect(
        asCtx(() => documents.createDraft({ documentTypeId: ids.pr, lines: lines(ids.b2026) } as never)),
      ).rejects.toMatchObject({ messageKey: 'fiscalYear.noOpenYear', params: { year: 2027 } });
      const counters = await orm.em.fork().count(DocRunningNumber, { documentType: ids.pr, year: 2027 }, FILTER_OFF);
      expect(counters).toBe(0);
    });

    it('creates a document that uses no budget, numbered in the new year', async () => {
      onDay('2027-01-02T03:00:00Z');
      const doc = await asCtx(() => documents.createDraft({ documentTypeId: ids.memo } as never));
      expect(doc.docNo).toContain('-2027-');
    });

    it('marks budget types blocked in the creatable list, and only those', async () => {
      onDay('2027-01-02T03:00:00Z');
      const types = await asCtx(() => documents.listCreatableTypes());
      expect(types.find((t) => t.code === 'PR')!.blocked).toEqual({ key: 'fiscalYear.noOpenYear', year: 2027 });
      expect(types.find((t) => t.code === 'MEMO')!.blocked).toBeUndefined();
    });

    it('lets a successor through: its predecessor already holds the money', async () => {
      onDay('2027-01-02T03:00:00Z');
      const doc = await asCtx(() =>
        documents.createDraft({ documentTypeId: ids.pr, lines: lines(ids.b2026) } as never, { asSuccessor: true }),
      );
      expect(doc.docNo).toContain('-2027-');
    });
  });

  describe("numbered by the company's own year", () => {
    it('is 2027 at 03:00 local on January 1, while UTC is still December 31', async () => {
      onDay('2026-12-31T20:00:00Z');
      const doc = await asCtx(() => documents.createDraft({ documentTypeId: ids.memo } as never));
      expect(doc.docNo).toContain('-2027-');
    });
  });

  describe('a year that exists but holds no approved budget', () => {
    it('still refuses a budget document', async () => {
      const em = orm.em.fork();
      const fy = em.create(FiscalYear, { company: em.getReference(Company, ids.company), year: 2027, startDate: '2027-01-01', endDate: '2027-12-31', status: 'OPEN' });
      await em.flush();
      ids.fy2027 = fy.id;
      onDay('2027-01-02T03:00:00Z');
      await expect(
        asCtx(() => documents.createDraft({ documentTypeId: ids.pr, lines: lines(ids.b2026) } as never)),
      ).rejects.toMatchObject({ messageKey: 'fiscalYear.noActiveBudget', params: { year: 2027 } });
    });
  });

  describe('once both years are budgeted', () => {
    beforeAll(async () => {
      const em = orm.em.fork();
      const fy = await em.findOneOrFail(FiscalYear, { id: ids.fy2027 }, FILTER_OFF);
      const dept = await em.findOneOrFail(Department, { id: ids.dept }, FILTER_OFF);
      const company = await em.findOneOrFail(Company, { id: ids.company }, FILTER_OFF);
      // Same account as last year's: the chart of accounts is not per year, only the budget is.
      const lastYear = await em.findOneOrFail(Budget, { id: ids.b2026 }, FILTER_OFF);
      const b = budgetAt(em, { fiscalYear: fy, department: dept, code: '6.101', glAccount: '612.06', account: lastYear.account, amountTotal: '1000000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });
      attachCoverage(em, company, b);
      await em.flush();
      ids.b2027 = b.id;
    });

    it("offers only this year's budget, though last year's is still ACTIVE under the same code", async () => {
      onDay('2027-01-05T03:00:00Z');
      const offered = await asCtx(() => budgets.listSelectable());
      expect(offered.map((b) => b.id)).toEqual([ids.b2027]);
    });

    it("refuses at submit a draft still naming last year's budget, and reserves nothing", async () => {
      onDay('2027-01-05T03:00:00Z');
      const id = await draftCharging(ids.b2026);
      await expect(asCtx(() => submit.submit(id))).rejects.toMatchObject({
        messageKey: 'fiscalYear.lineWrongYear',
        params: { lineNo: 1, budgetYear: 2026, year: 2027 },
      });
      expect(await orm.em.fork().count(BudgetTxn, { document: id }, FILTER_OFF)).toBe(0);
    });

    it("keeps last year's budget on a successor whose predecessor charged it", async () => {
      onDay('2027-01-05T03:00:00Z');
      const predecessor = await draftCharging(ids.b2026);
      const successor = await draftCharging(ids.b2026, predecessor);
      const offered = await asCtx(() => budgets.listSelectable(undefined, successor));
      expect(offered.find((b) => b.id === ids.b2026)?.inherited).toBe(true);
      // Submit lets the line through the year check; whatever else it decides is not this spec's.
      await asCtx(() => submit.submit(successor)).catch((e: { messageKey?: string }) => {
        expect(e.messageKey).not.toBe('fiscalYear.lineWrongYear');
      });
    });

    it('lists one year at a time when the budget list is asked for a year, and every year when not', async () => {
      const only2026 = await asCtx(() => budgets.list({ fiscalYearId: ids.fy2026 }));
      expect(only2026.items.map((b) => b.id)).toEqual([ids.b2026]);
      const only2027 = await asCtx(() => budgets.list({ fiscalYearId: ids.fy2027 }));
      expect(only2027.items.map((b) => b.id)).toEqual([ids.b2027]);
      const all = await asCtx(() => budgets.list({}));
      expect(all.items.map((b) => b.id).sort()).toEqual([ids.b2026, ids.b2027].sort());
    });

    it("does not keep last year's budget on a draft that merely chose it", async () => {
      onDay('2027-01-05T03:00:00Z');
      const id = await draftCharging(ids.b2026);
      const offered = await asCtx(() => budgets.listSelectable(undefined, id));
      expect(offered.map((b) => b.id)).toEqual([ids.b2027]);
    });
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[fiscal-year-guard] no database reachable — skipping DB-backed spec');
}

import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { attachCoverage, budgetAt } from '../../test/budget-fixture';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ControlPolicy, DocCategory } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { AccountService } from '../accounting/account.service';
import { BudgetService } from '../budget/budget.service';
import { Budget } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { ItemService } from '../master-data/item.service';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { AppUser } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentTypeService } from './document-type.service';
import { DeptDocType, Document, DocumentCategory, DocumentLine, DocumentType, FormTemplate } from './document.entities';
import { DocumentService } from './document.service';
import { NumberingService } from './numbering.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

function asCtx<T>(companyId: string, departmentId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run({ userId: GLOBAL.userId, companyId, departmentId, grants: [] }, fn);
}
const GLOBAL = { userId: '' };

/**
 * `document_type.default_gl_account`: what an item-less line is stamped with when nothing else says.
 *
 * It supplies the ACCOUNT only. It used to supply the budget too, by looking one up from the GL —
 * a lookup that has no answer now that several budgets share an account.
 */
describe.skipIf(!hasDb)('document-type default GL (DB-backed)', () => {
  let orm: MikroORM;
  let documents: DocumentService;

  const ids = {
    companyA: '', deptA: '',
    dtDefault: '', dtNoBudgetGl: '', dtPlain: '',
    budgetElec: '', budgetOther: '',
  };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const companyA = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const deptA = em.create(Department, { company: companyA, deptCode: 'DA', name: 'DA', isActive: true });
    const y = new Date().getUTCFullYear();
    const fyA = em.create(FiscalYear, { company: companyA, year: y, startDate: `${y}-01-01`, endDate: `${y}-12-31`, status: 'OPEN' });
    const wfA = em.create(Workflow, { company: companyA, name: 'WFA', isActive: true });
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });

    // A requires_budget type whose default GL (5210) HAS a budget; another whose default GL
    // (5999) has NO budget; and a plain type with a default GL but no budget control.
    const dtDefault = em.create(DocumentType, { company: companyA, code: 'UTIL', name: 'Utilities', category: DocCategory.FINANCE, requiresBudget: true, requiresQuota: false, defaultGlAccount: '5210', isActive: true });
    const dtNoBudgetGl = em.create(DocumentType, { company: companyA, code: 'UTILX', name: 'Utilities X', category: DocCategory.FINANCE, requiresBudget: true, requiresQuota: false, defaultGlAccount: '5999', isActive: true });
    const dtPlain = em.create(DocumentType, { company: companyA, code: 'MEMO', name: 'Memo', category: DocCategory.ADMIN, requiresBudget: false, requiresQuota: false, defaultGlAccount: '5210', isActive: true });
    for (const [dt] of [[dtDefault], [dtNoBudgetGl], [dtPlain]] as const) {
      const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
      em.create(DeptDocType, { department: deptA, documentType: dt, formTemplate: tmpl, workflow: wfA, isActive: true });
    }

    const budgetElec = budgetAt(em, { fiscalYear: fyA, department: deptA, code: '5210', glAccount: '5210', budgetName: 'Utilities', amountTotal: '1000000000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });
    attachCoverage(em, companyA, budgetElec);
    const budgetOther = budgetAt(em, { fiscalYear: fyA, department: deptA, code: '5300', glAccount: '5300', budgetName: 'Other', amountTotal: '1000000000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });
    attachCoverage(em, companyA, budgetOther);

    await em.flush();
    GLOBAL.userId = user.id;
    Object.assign(ids, {
      companyA: companyA.id, deptA: deptA.id,
      dtDefault: dtDefault.id, dtNoBudgetGl: dtNoBudgetGl.id, dtPlain: dtPlain.id,
      budgetElec: budgetElec.id, budgetOther: budgetOther.id,
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
    const itemService = new ItemService(orm.em, scope, new ScopeService(), new AccountService(orm.em, scope));
    const budgetService = new BudgetService(orm.em, new AccountService(orm.em, scope), new BudgetBalanceService(orm.em));
    const fiscalYears = new FiscalYearService(scope);
    documents = new DocumentService(orm.em, scope, new DeptDocTypeService(orm.em), new NumberingService(orm.em), itemService, budgetService, fiscalYears);
  });

  const lineOf = async (documentId: string) =>
    (await orm.em.fork().find(DocumentLine, { document: documentId }, { filters: { company: false }, populate: ['budget'] }))[0];

  it('stamps the type default GL on an item-less line and leaves the budget unset', async () => {
    const doc = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({
        documentTypeId: ids.dtDefault,
        lines: [{ lineNo: 1, description: 'ລົດສາຍຫຼັກ ປະຈຳເດືອນ 06.26', qty: '1', unitPrice: '889000000', lineAmount: '889000000' }],
      }),
    );
    const line = await lineOf(doc.id);
    expect(line.glAccount).toBe('5210');
    expect(line.budget).toBeNull(); // the account no longer names a budget on the requester's behalf
  });

  it('keeps the type default GL and the named budget on the same line', async () => {
    const doc = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({
        documentTypeId: ids.dtDefault,
        lines: [{ lineNo: 1, description: 'utilities', qty: '1', unitPrice: '100', lineAmount: '100', budgetId: ids.budgetElec }],
      }),
    );
    const line = await lineOf(doc.id);
    expect(line.glAccount).toBe('5210');
    expect(line.budget?.id).toBe(ids.budgetElec);
  });

  it('the type default GL stands even when the named budget records another', async () => {
    // The inverted direction: naming a budget used to overwrite the account. Now the configured
    // default wins, and the budget's own `gl_account` is read only when nothing else supplies one.
    const doc = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({
        documentTypeId: ids.dtDefault,
        lines: [{ lineNo: 1, description: 'override', qty: '1', unitPrice: '100', lineAmount: '100', budgetId: ids.budgetOther }],
      }),
    );
    const line = await lineOf(doc.id);
    expect(line.budget?.id).toBe(ids.budgetOther);
    expect(line.glAccount).toBe('5210');
  });

  it('stamps a default GL that no budget shares, without complaint', async () => {
    const doc = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({
        documentTypeId: ids.dtNoBudgetGl,
        lines: [{ lineNo: 1, description: 'no budget for 5999', qty: '1', unitPrice: '50', lineAmount: '50' }],
      }),
    );
    const line = await lineOf(doc.id);
    expect(line.glAccount).toBe('5999'); // GL still stamped from the default
    expect(line.budget).toBeNull(); // but no budget resolved — not rejected
  });

  it('stamps the default GL without a budget on a non-budget type', async () => {
    const doc = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({
        documentTypeId: ids.dtPlain,
        lines: [{ lineNo: 1, description: 'info', qty: '1', unitPrice: '0', lineAmount: '0' }],
      }),
    );
    const line = await lineOf(doc.id);
    expect(line.glAccount).toBe('5210');
    expect(line.budget).toBeNull();
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[doc-type-default-gl] no database reachable — skipping DB-backed spec');
}

// --- Document-type config round-trips defaultGlAccount (task 2.4) -------------
describe.skipIf(!hasDb)('document-type config: defaultGlAccount round-trip', () => {
  let orm: MikroORM;
  let types: DocumentTypeService;
  let companyId = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const c = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    // Document-type create validates its category against an active document_category; seed them.
    for (const code of [DocCategory.ADMIN, DocCategory.FINANCE]) {
      em.create(DocumentCategory, { company: c, code, name: code, isActive: true });
    }
    await em.flush();
    companyId = c.id;
    types = new DocumentTypeService(orm.em.fork());
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('defaults to null when omitted and round-trips on create/update', async () => {
    await RequestContext.run({ userId: 'u', companyId, departmentId: 'd', grants: [] }, async () => {
      const created = await types.create({ code: 'D1', name: 'D', category: DocCategory.ADMIN });
      expect(created.defaultGlAccount).toBeUndefined();

      const withGl = await types.create({ code: 'D2', name: 'D2', category: DocCategory.FINANCE, defaultGlAccount: '5210' });
      expect(withGl.defaultGlAccount).toBe('5210');

      const updated = await types.update(created.id, { defaultGlAccount: '5300' });
      expect(updated.defaultGlAccount).toBe('5300');
    });
  });
});

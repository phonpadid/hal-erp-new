import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { AccountService } from '../accounting/account.service';
import { BudgetService } from '../budget/budget.service';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { Currency } from '../currency/currency.entities';
import { ItemService } from '../master-data/item.service';
import { Vendor } from '../master-data/master-data.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentType, FormTemplate } from './document.entities';
import { Document } from './document.entities';
import { DocumentService } from './document.service';
import { NumberingService } from './numbering.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

function asCtx<T>(companyId: string, departmentId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run({ userId: '', companyId, departmentId, grants: [] }, fn);
}

describe.skipIf(!hasDb)('document list filtering (DB-backed)', () => {
  let orm: MikroORM;
  let documents: DocumentService;
  const ids = { companyA: '', deptA: '', companyB: '', deptB: '', dtMemo: '', dtPr: '', vendorB: '' };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const companyA = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const companyB = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true });
    const deptA = em.create(Department, { company: companyA, deptCode: 'DA', name: 'DA', isActive: true });
    const deptB = em.create(Department, { company: companyB, deptCode: 'DB', name: 'DB', isActive: true });
    const wfA = em.create(Workflow, { company: companyA, name: 'WFA', isActive: true });
    const wfB = em.create(Workflow, { company: companyB, name: 'WFB', isActive: true });
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });
    const dtMemo = em.create(DocumentType, { company: companyA, code: 'MEMO', name: 'Memo', category: DocCategory.ADMIN, requiresBudget: false, requiresQuota: false, isActive: true });
    const dtPr = em.create(DocumentType, { company: companyA, code: 'PR', name: 'PR', category: DocCategory.PROCUREMENT, requiresBudget: true, requiresQuota: false, isActive: true });
    const tmplMemo = em.create(FormTemplate, { documentType: dtMemo, version: 1, status: 'PUBLISHED' });
    const tmplPr = em.create(FormTemplate, { documentType: dtPr, version: 1, status: 'PUBLISHED' });
    const vendorB = em.create(Vendor, { vendorCode: 'V-B', name: 'VendorB', paymentTermDays: 30, isActive: true });

    const mkDoc = (
      company: Company,
      department: Department,
      docType: DocumentType,
      tmpl: FormTemplate,
      wf: Workflow,
      docNo: string,
      status: DocStatus,
      baseTotalAmount: string,
      createdAt: Date,
    ) =>
      em.create(Document, {
        docNo, company, department, documentType: docType, formTemplate: tmpl, workflow: wf,
        createdBy: user, exchangeRate: '1', status, baseTotalAmount, createdAt,
      });

    // Company A: three documents with distinct status / amount / date.
    mkDoc(companyA, deptA, dtMemo, tmplMemo, wfA, 'A-MEMO-1', DocStatus.DRAFT, '100.00', new Date('2026-06-01T08:00:00Z'));
    mkDoc(companyA, deptA, dtPr, tmplPr, wfA, 'A-PR-1', DocStatus.SUBMITTED, '5000.00', new Date('2026-06-10T08:00:00Z'));
    mkDoc(companyA, deptA, dtPr, tmplPr, wfA, 'A-PR-2', DocStatus.SUBMITTED, '9999999999999.99', new Date('2026-06-24T23:30:00Z'));
    // Company B: one document, to prove isolation.
    mkDoc(companyB, deptB, dtPr, tmplPr, wfB, 'B-PR-1', DocStatus.SUBMITTED, '5000.00', new Date('2026-06-10T08:00:00Z'));

    await em.flush();
    Object.assign(ids, {
      companyA: companyA.id, deptA: deptA.id, companyB: companyB.id, deptB: deptB.id,
      dtMemo: dtMemo.id, dtPr: dtPr.id, vendorB: vendorB.id,
    });

    const scope = new CompanyScopeService(orm.em);
    documents = new DocumentService(orm.em, scope, new DeptDocTypeService(orm.em), new NumberingService(orm.em), new ItemService(orm.em, scope, new ScopeService(), new AccountService(orm.em, scope)), new BudgetService(orm.em, new AccountService(orm.em, scope)), new FiscalYearService(scope));
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('filters by status, returning only matching company-A documents', async () => {
    const res = await asCtx(ids.companyA, ids.deptA, () => documents.list({ status: [DocStatus.SUBMITTED] }));
    expect(res.items).toHaveLength(2);
    expect(res.items.every((d) => d.status === DocStatus.SUBMITTED)).toBe(true);
  });

  it('combines a type filter with a created-date range (createdTo inclusive of the end day)', async () => {
    const res = await asCtx(ids.companyA, ids.deptA, () =>
      documents.list({ documentTypeId: ids.dtPr, createdFrom: '2026-06-24', createdTo: '2026-06-24' }),
    );
    // A-PR-2 was created at 23:30 on the 24th — included only because createdTo is end-of-day.
    expect(res.items.map((d) => d.docNo)).toEqual(['A-PR-2']);
  });

  it('filters an amount range on the exact decimal string (within decimal(15,2) precision)', async () => {
    // Largest value the canonical decimal(15,2) column holds; compared as an exact string, not a
    // JS number. (A value above MAX_SAFE_INTEGER cannot fit decimal(15,2), so we use the column max.)
    const res = await asCtx(ids.companyA, ids.deptA, () => documents.list({ minAmount: '9999999999999.00' }));
    expect(res.items.map((d) => d.docNo)).toEqual(['A-PR-2']);
    expect(res.items[0].baseTotalAmount).toBe('9999999999999.99');
  });

  it('does the doc-no contains search server-side', async () => {
    const res = await asCtx(ids.companyA, ids.deptA, () => documents.list({ docNo: 'pr-' }));
    expect(res.items.map((d) => d.docNo).sort()).toEqual(['A-PR-1', 'A-PR-2']);
  });

  it('leaks nothing when filtering by another company\'s vendor', async () => {
    const res = await asCtx(ids.companyA, ids.deptA, () => documents.list({ vendorId: ids.vendorB }));
    expect(res.items).toHaveLength(0);
  });

  it('no filters returns the full company-A list (and never company B)', async () => {
    const res = await asCtx(ids.companyA, ids.deptA, () => documents.list({}));
    expect(res.items).toHaveLength(3);
    expect(res.items.every((d) => d.docNo.startsWith('A-'))).toBe(true);
  });
});

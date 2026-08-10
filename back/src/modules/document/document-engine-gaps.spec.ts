import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { fakeUpload } from '../../test/fake-upload';
import { Workflow } from '../approval/approval.entities';
import { Currency } from '../currency/currency.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { BudgetTxn } from '../budget/budget.entities';
import { ItemService } from '../master-data/item.service';
import { VendorService } from '../master-data/vendor.service';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { AccountService } from '../accounting/account.service';
import { BudgetService } from '../budget/budget.service';
import { AppUser } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentService } from './document.service';
import { DocumentSubmitService } from './document-submit.service';
import { FormTemplateService } from './form-template.service';
import { AttachmentService } from './attachment.service';
import { NumberingService } from './numbering.service';
import {
  DeptDocType,
  DocFieldValue,
  Document,
  DocumentLine,
  DocumentType,
  DocumentTypeRef,
  FormField,
  FormTemplate,
} from './document.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;
const GLOBAL = { userId: '' };
const asCtx = <T>(companyId: string, departmentId: string, fn: () => Promise<T>): Promise<T> =>
  RequestContext.run({ userId: GLOBAL.userId, companyId, departmentId, grants: [] }, fn);

/** A StorageService stub — the attachment tests assert wiring, not real S3. */
const fakeStorage = {
  buildKey: (documentId: string, fileName: string) => `documents/${documentId}/${fileName}`,
  putObject: async () => undefined,
  presignDownload: async (key: string) => `https://bucket.local/${key}?get`,
} as any;

describe.skipIf(!hasDb)('document-engine gaps (DB-backed)', () => {
  let orm: MikroORM;
  let templates: FormTemplateService;
  let documents: DocumentService;
  let submit: DocumentSubmitService;
  let attachments: AttachmentService;

  const ids = {
    companyA: '', deptA: '', companyB: '', deptB: '',
    dtMemo: '', dtPR: '', dtPO: '',
    tmplDraft: '', tmplCond: '', fieldA: '', fieldB: '',
    prApproved: '', prDraft: '', docB: '',
  };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const companyA = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const companyB = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true });
    const deptA = em.create(Department, { company: companyA, deptCode: 'DA', name: 'DA', isActive: true });
    const deptB = em.create(Department, { company: companyB, deptCode: 'DB', name: 'DB', isActive: true });
    em.create(FiscalYear, { company: companyA, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const wfA = em.create(Workflow, { company: companyA, name: 'WFA', isActive: true });
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });

    const dtMemo = em.create(DocumentType, { company: companyA, code: 'MEMO', name: 'Memo', category: DocCategory.ADMIN, requiresBudget: false, requiresQuota: false, isActive: true });
    const dtPR = em.create(DocumentType, { company: companyA, code: 'PR', name: 'PR', category: DocCategory.PROCUREMENT, requiresBudget: false, requiresQuota: false, isActive: true });
    const dtPO = em.create(DocumentType, { company: companyA, code: 'PO', name: 'PO', category: DocCategory.PROCUREMENT, requiresBudget: false, requiresQuota: false, isActive: true });
    // Reference-chain pairing PR→PO (was hardcoded REF_CHAIN; now document_type_ref data).
    em.create(DocumentTypeRef, { company: companyA, predecessorType: dtPR, successorType: dtPO });

    // A DRAFT template to exercise immutability + field-type validation.
    const tmplDraft = em.create(FormTemplate, { documentType: dtMemo, version: 1, status: 'DRAFT' });
    // A PUBLISHED template with a conditional required field B (shown when A == 'YES').
    const tmplCond = em.create(FormTemplate, { documentType: dtPR, version: 1, status: 'PUBLISHED' });
    const fieldA = em.create(FormField, { formTemplate: tmplCond, fieldName: 'A', fieldLabel: 'A', fieldType: 'text', isRequired: false, sortOrder: 0 });
    const fieldB = em.create(FormField, { formTemplate: tmplCond, fieldName: 'B', fieldLabel: 'B', fieldType: 'text', isRequired: true, sortOrder: 1, conditionJson: JSON.stringify({ field: 'A', op: 'eq', value: 'YES' }) });
    const tmplPO = em.create(FormTemplate, { documentType: dtPO, version: 1, status: 'PUBLISHED' });

    em.create(DeptDocType, { department: deptA, documentType: dtMemo, formTemplate: tmplDraft, workflow: wfA, isActive: true });
    em.create(DeptDocType, { department: deptA, documentType: dtPR, formTemplate: tmplCond, workflow: wfA, isActive: true });
    em.create(DeptDocType, { department: deptA, documentType: dtPO, formTemplate: tmplPO, workflow: wfA, isActive: true });

    await em.flush();
    GLOBAL.userId = user.id;
    Object.assign(ids, {
      companyA: companyA.id, deptA: deptA.id, companyB: companyB.id, deptB: deptB.id,
      dtMemo: dtMemo.id, dtPR: dtPR.id, dtPO: dtPO.id,
      tmplDraft: tmplDraft.id, tmplCond: tmplCond.id, fieldA: fieldA.id, fieldB: fieldB.id,
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
    const numbering = new NumberingService(orm.em);
    const itemService = new ItemService(orm.em, scope, new ScopeService(), new AccountService(orm.em, scope));
    const vendorService = new VendorService(orm.em, scope, new ScopeService());
    templates = new FormTemplateService(orm.em);
    documents = new DocumentService(orm.em, scope, new DeptDocTypeService(orm.em), numbering, itemService, new BudgetService(orm.em, new AccountService(orm.em, scope), new BudgetBalanceService(orm.em), new BudgetCoverageService(orm.em)), new FiscalYearService(scope));
    const budgetBal = new BudgetBalanceService(orm.em);
    submit = new DocumentSubmitService(
      orm.em,
      new ExchangeRateService(orm.em),
      new FiscalYearService(scope),
      vendorService,
      itemService,
      new BudgetLedgerService(orm.em, budgetBal, new BudgetCoverageService(orm.em)),
      new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em)),
    );
    attachments = new AttachmentService(orm.em, scope, fakeStorage);
  });

  // ---- Group 2: lifecycle + field-type validation ----------------------------

  it('rejects adding a field to a PUBLISHED template', async () => {
    await expect(
      templates.addField({ formTemplateId: ids.tmplCond, fieldName: 'x', fieldLabel: 'X', fieldType: 'text' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an unknown field type and a dropdown without options', async () => {
    await expect(
      templates.addField({ formTemplateId: ids.tmplDraft, fieldName: 'y', fieldLabel: 'Y', fieldType: 'bogus' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      templates.addField({ formTemplateId: ids.tmplDraft, fieldName: 'z', fieldLabel: 'Z', fieldType: 'dropdown' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('publishes then retires a template, and blocks re-publish', async () => {
    const t = await templates.createTemplate({ documentTypeId: ids.dtMemo });
    await templates.addField({ formTemplateId: t.id, fieldName: 'a', fieldLabel: 'A', fieldType: 'text' });
    const published = await templates.publish(t.id);
    expect(published.status).toBe('PUBLISHED');
    const retired = await templates.retire(t.id);
    expect(retired.status).toBe('RETIRED');
    await expect(templates.publish(t.id)).rejects.toBeInstanceOf(ConflictException);
  });

  // ---- Group 3: conditional submit ------------------------------------------

  it('does not require a hidden conditional field and drops its stored value', async () => {
    const doc = await asCtx(ids.companyA, ids.deptA, async () => {
      const d = await documents.createDraft({
        documentTypeId: ids.dtPR,
        fieldValues: [
          { formFieldId: ids.fieldA, value: 'NO' },
          { formFieldId: ids.fieldB, value: 'leftover' },
        ],
      });
      return submit.submit(d.id);
    });
    expect(doc.status).toBe(DocStatus.SUBMITTED);
    const remaining = await orm.em.fork().find(DocFieldValue, { document: doc.id, formField: ids.fieldB }, FILTER_OFF);
    expect(remaining).toHaveLength(0); // hidden field value dropped
  });

  it('still requires a visible conditional field', async () => {
    await expect(
      asCtx(ids.companyA, ids.deptA, async () => {
        const d = await documents.createDraft({
          documentTypeId: ids.dtPR,
          fieldValues: [{ formFieldId: ids.fieldA, value: 'YES' }],
        });
        return submit.submit(d.id);
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ---- Group 5: reference chain + create-from --------------------------------

  it('rejects referencing an unapproved predecessor', async () => {
    await asCtx(ids.companyA, ids.deptA, async () => {
      const pr = await documents.createDraft({ documentTypeId: ids.dtPR });
      ids.prDraft = pr.id;
    });
    await expect(
      asCtx(ids.companyA, ids.deptA, () =>
        documents.createDraft({ documentTypeId: ids.dtPO, refDocumentId: ids.prDraft }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('treats a cross-company predecessor as not-found', async () => {
    // A document created in company B…
    await asCtx(ids.companyB, ids.deptB, async () => {
      // company B has no mapping; create directly to get a foreign id.
    });
    const em = orm.em.fork();
    const foreign = em.create(Document, {
      docNo: 'X-1', company: em.getReference(Company, ids.companyB), department: em.getReference(Department, ids.deptB),
      documentType: em.getReference(DocumentType, ids.dtPR), formTemplate: em.getReference(FormTemplate, ids.tmplCond),
      workflow: em.getReference(Workflow, (await em.find(Workflow, {}, { ...FILTER_OFF, limit: 1 }))[0].id),
      createdBy: em.getReference(AppUser, GLOBAL.userId), exchangeRate: '1', status: DocStatus.APPROVED, createdAt: new Date(),
    });
    await em.persistAndFlush(foreign);
    await expect(
      asCtx(ids.companyA, ids.deptA, () =>
        documents.createDraft({ documentTypeId: ids.dtPO, refDocumentId: foreign.id }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates a PO from an approved PR, copying lines and creating no holds', async () => {
    const po = await asCtx(ids.companyA, ids.deptA, async () => {
      const pr = await documents.createDraft({
        documentTypeId: ids.dtPR,
        lines: [
          { lineNo: 1, description: 'a', qty: '2', unitPrice: '50', lineAmount: '100' },
          { lineNo: 2, description: 'b', qty: '1', unitPrice: '30', lineAmount: '30' },
        ],
      });
      // Approve the PR out-of-band.
      const em = orm.em.fork();
      const row = await em.findOneOrFail(Document, { id: pr.id }, FILTER_OFF);
      row.status = DocStatus.APPROVED;
      await em.flush();
      return documents.createFrom(pr.id, ids.dtPO);
    });
    expect(po.status).toBe(DocStatus.DRAFT);
    expect(po.refDocument?.id).toBeDefined();
    const lines = await orm.em.fork().find(DocumentLine, { document: po.id }, FILTER_OFF);
    expect(lines).toHaveLength(2);
    const txns = await orm.em.fork().find(BudgetTxn, { document: po.id }, FILTER_OFF);
    expect(txns).toHaveLength(0);
  });

  it('issues unique sequential numbers for concurrent create-from (locked counter)', async () => {
    const refId = await asCtx(ids.companyA, ids.deptA, async () => {
      const pr = await documents.createDraft({ documentTypeId: ids.dtPR });
      const em = orm.em.fork();
      const row = await em.findOneOrFail(Document, { id: pr.id }, FILTER_OFF);
      row.status = DocStatus.APPROVED;
      await em.flush();
      return pr.id;
    });
    const [a, b] = await asCtx(ids.companyA, ids.deptA, () =>
      Promise.all([documents.createFrom(refId, ids.dtPO), documents.createFrom(refId, ids.dtPO)]),
    );
    expect(a.docNo).not.toBe(b.docNo);
    expect(new Set([a.docNo, b.docNo]).size).toBe(2);
  });

  // ---- Group 4: attachment scoping ------------------------------------------

  it('uploads attachment metadata and lists it, scoped to the active company', async () => {
    const out = await asCtx(ids.companyA, ids.deptA, async () => {
      const d = await documents.createDraft({ documentTypeId: ids.dtMemo });
      const att = await attachments.upload(d.id, fakeUpload('r.pdf', 'application/pdf'));
      return { docId: d.id, attKey: att.filePath, list: await attachments.list(d.id) };
    });
    expect(out.attKey).toBe(`documents/${out.docId}/r.pdf`);
    expect(out.list).toHaveLength(1);
    expect(out.list[0].fileName).toBe('r.pdf');
  });
});

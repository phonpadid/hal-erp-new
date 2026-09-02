import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocCategory } from '../../common/enums';
import { ErrorCode } from '../../common/errors/error-code';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { AccountService } from '../accounting/account.service';
import { BudgetService } from '../budget/budget.service';
import { ItemService } from '../master-data/item.service';
import { Company, Department } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { AppUser } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentService } from './document.service';
import { NumberingService } from './numbering.service';
import {
  DeptDocType, DocFieldValue, DocumentCategory, DocumentType, FormField, FormTemplate,
} from './document.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;
const G = { userId: '' };

/**
 * A field that offers a fixed set of values only accepts one of them.
 *
 * Until this existed a dropdown was decoration. The form read advertised the choices, the write
 * stored any string at all, and the mismatch surfaced — if ever — far downstream. `settlementKind`
 * is the case that proved it: a claim could be marked with a settlement the system cannot post,
 * approve, raise a payable, and then be unsettleable, with a liability and no way to clear it.
 *
 * Nothing here names a document type. The options on the field are the rule.
 */
describe.skipIf(!hasDb)('a choice field only accepts what it offers (DB-backed)', () => {
  let orm: MikroORM;
  let documents: DocumentService;
  const ids = { company: '', dept: '', dt: '', choice: '', free: '', broken: '' };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });
    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: 'A', branchCode: '00000', isActive: true });
    const dept = em.create(Department, { company, deptCode: 'DA', name: 'DA', isActive: true });
    em.create(DocumentCategory, { company, code: DocCategory.FINANCE, name: 'F', isActive: true });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    const dt = em.create(DocumentType, {
      company, code: 'MEMO', name: 'Memo', category: DocCategory.FINANCE, isActive: true,
    } as never);
    const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
    const choice = em.create(FormField, {
      formTemplate: tmpl, fieldName: 'settlementKind', fieldLabel: 'How', fieldType: 'dropdown',
      isRequired: false, sortOrder: 1, optionsJson: JSON.stringify(['CASH']),
    } as never);
    const free = em.create(FormField, {
      formTemplate: tmpl, fieldName: 'reason', fieldLabel: 'Reason', fieldType: 'text',
      isRequired: false, sortOrder: 2,
    } as never);
    const broken = em.create(FormField, {
      formTemplate: tmpl, fieldName: 'legacy', fieldLabel: 'Legacy', fieldType: 'dropdown',
      isRequired: false, sortOrder: 3, optionsJson: 'not json at all',
    } as never);
    em.create(DeptDocType, { department: dept, documentType: dt, formTemplate: tmpl, workflow: wf, isActive: true });
    await em.flush();
    G.userId = user.id;
    Object.assign(ids, {
      company: company.id, dept: dept.id, dt: dt.id,
      choice: choice.id, free: free.id, broken: broken.id,
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
    documents = new DocumentService(
      orm.em, scope, new DeptDocTypeService(orm.em), new NumberingService(orm.em),
      new ItemService(orm.em, scope, new ScopeService(), accounts),
      new BudgetService(orm.em, accounts, new BudgetBalanceService(orm.em)), new FiscalYearService(scope),
    );
  });

  const asUser = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: G.userId, companyId: ids.company, departmentId: ids.dept, grants: [] }, fn);

  const draft = () => asUser(() => documents.createDraft({ documentTypeId: ids.dt } as never));

  const stored = async (documentId: string, formFieldId: string) =>
    (await orm.em.fork().findOne(DocFieldValue, { document: documentId, formField: formFieldId }, FILTER_OFF))
      ?.fieldValue;

  it('accepts an offered value', async () => {
    const doc = await draft();
    await asUser(() => documents.setFieldValues(doc.id, [{ formFieldId: ids.choice, value: 'CASH' }]));
    expect(await stored(doc.id, ids.choice)).toBe('CASH');
  });

  it('refuses a value the field does not offer, naming what it does', async () => {
    const doc = await draft();
    await expect(
      asUser(() => documents.setFieldValues(doc.id, [{ formFieldId: ids.choice, value: 'GOODS' }])),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    expect(await stored(doc.id, ids.choice)).toBeUndefined();
  });

  // The refusal has to happen before anything is written, or a caller sending several values gets
  // a rejection and a half-updated document.
  it('writes nothing at all when one value in the batch is refused', async () => {
    const doc = await draft();
    await expect(
      asUser(() => documents.setFieldValues(doc.id, [
        { formFieldId: ids.free, value: 'a good reason' },
        { formFieldId: ids.choice, value: 'GOODS' },
      ])),
    ).rejects.toThrow();
    expect(await stored(doc.id, ids.free)).toBeUndefined();
  });

  it('leaves a free-text field free', async () => {
    const doc = await draft();
    await asUser(() => documents.setFieldValues(doc.id, [{ formFieldId: ids.free, value: 'anything' }]));
    expect(await stored(doc.id, ids.free)).toBe('anything');
  });

  it('lets a choice field be cleared', async () => {
    const doc = await draft();
    await asUser(() => documents.setFieldValues(doc.id, [{ formFieldId: ids.choice, value: 'CASH' }]));
    await asUser(() => documents.setFieldValues(doc.id, [{ formFieldId: ids.choice, value: '' }]));
    expect(await stored(doc.id, ids.choice)).toBe('');
  });

  // One unreadable option list is a bad config row, not a reason to stop accepting documents.
  it('does not enforce a set it cannot read', async () => {
    const doc = await draft();
    await asUser(() => documents.setFieldValues(doc.id, [{ formFieldId: ids.broken, value: 'whatever' }]));
    expect(await stored(doc.id, ids.broken)).toBe('whatever');
  });
});

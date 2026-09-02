import { carriesMarkup, isHtmlFieldType } from '@erp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company } from '../multi-company/multi-company.entities';
import { seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { AccountService } from '../accounting/account.service';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { BudgetService } from '../budget/budget.service';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { ItemService } from '../master-data/item.service';
import { NumberingService } from './numbering.service';
import { ScopeService } from '../rbac/scope.service';
import { AppUser } from '../rbac/rbac.entities';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentService } from './document.service';
import { DocFieldValue, DocumentType, FormField, FormTemplate } from './document.entities';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/** Pure rules — the two halves of the field-type contract, with no database in the way. */
describe('the shape a field type declares (@erp/shared)', () => {
  it('names the rich-text types and only those', () => {
    for (const t of ['text', 'richtext', 'rich_text', 'html', 'TEXT']) {
      expect(isHtmlFieldType(t)).toBe(true);
    }
    for (const t of ['string', 'number', 'date', 'dropdown', 'file', 'line_items', undefined]) {
      expect(isHtmlFieldType(t)).toBe(false);
    }
  });

  it('spots the editor leavings a plain value must not carry', () => {
    // The exact value a `text` salary was stored as, and what the decimal guard then saw.
    expect(carriesMarkup('<p>7500000</p>')).toBe(true);
    expect(carriesMarkup('<p>Senior&nbsp;Officer</p>')).toBe(true);
    expect(carriesMarkup('&nbsp;')).toBe(true);
    expect(carriesMarkup('7500000')).toBe(false);
    expect(carriesMarkup('Senior Officer')).toBe(false);
    expect(carriesMarkup('2026-08-29')).toBe(false);
    expect(carriesMarkup('')).toBe(false);
    expect(carriesMarkup(undefined)).toBe(false);
    // A bare comparison is not markup — refusing "a < b" would be worse than the bug.
    expect(carriesMarkup('a < b and c > d')).toBe(false);
  });
});

describe.skipIf(!hasDb)('a value must match the shape its field declares (DB-backed)', () => {
  let orm: MikroORM;
  let documents: DocumentService;
  let companyA = '';
  let deptId = '';
  let userId = '';
  let promoteTypeId = '';
  const field: Record<string, string> = {};

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());
    const em = orm.em.fork();
    companyA = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    const promote = await em.findOneOrFail(DocumentType, { code: 'PROMOTE', company: companyA }, FILTER_OFF);
    promoteTypeId = promote.id;
    const tmpl = await em.findOneOrFail(FormTemplate, { documentType: promote.id }, FILTER_OFF);
    for (const f of await em.find(FormField, { formTemplate: tmpl.id }, FILTER_OFF)) {
      field[f.fieldName] = f.id;
    }
    // The seeded PROMOTE is mapped to Procurement, and the seeded requester belongs to it.
    const mapping = await em.getConnection().execute<{ department_id: string }[]>(
      `select department_id from dept_doc_type where document_type_id = '${promote.id}' and is_active = true limit 1`,
    );
    deptId = mapping[0].department_id;
    const user = await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF);
    userId = user.id;

    const scope = new CompanyScopeService(orm.em);
    documents = new DocumentService(
      orm.em,
      scope,
      new DeptDocTypeService(orm.em),
      new NumberingService(orm.em),
      new ItemService(orm.em, scope, new ScopeService(), new AccountService(orm.em, scope)),
      new BudgetService(orm.em, new BudgetBalanceService(orm.em), new BudgetCoverageService(orm.em)),
      new FiscalYearService(scope),
    );
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  const asA = <T>(fn: () => Promise<T>): Promise<T> =>
    RequestContext.run({ userId: userId, companyId: companyA, departmentId: deptId, grants: [] }, fn);

  /** A DRAFT promotion, created through the service so the mapping and numbering behave normally. */
  async function makeDraft(_em: EntityManager): Promise<string> {
    const doc = await asA(() => documents.createDraft({ documentTypeId: promoteTypeId } as never));
    return doc.id;
  }

  it('types the promotion fields by what their values are, not by which editor is convenient', async () => {
    const em = orm.em.fork();
    const byName = new Map(
      (await em.find(FormField, { id: { $in: Object.values(field) } }, FILTER_OFF)).map((f) => [
        f.fieldName,
        f,
      ]),
    );
    // A salary is parsed by the post-action; `text` would store it as `<p>7500000</p>`.
    expect(byName.get('new_salary')!.fieldType).toBe('number');
    expect(byName.get('new_position')!.fieldType).toBe('string');
    expect(byName.get('effective_date')!.fieldType).toBe('date');
    // A level matching no configured job_level leaves an employee the approval router cannot place.
    const level = byName.get('new_job_level')!;
    expect(level.fieldType).toBe('dropdown');
    expect(level.optionsJson).toContain('MANAGER');
  });

  it('refuses markup written to a field that is not rich text, naming the field', async () => {
    // The write boundary, not the post-action: a misconfigured field becomes an error here rather
    // than a rollback discovered at approval by somebody who did not fill the form in.
    const em = orm.em.fork();
    const doc = await makeDraft(em);
    await expect(
      asA(() => documents.setFieldValues(doc, [{ formFieldId: field['new_salary'], value: '<p>7500000</p>' }])),
    ).rejects.toThrow(/new_salary/);
  });

  it('accepts the same value once it is the value and not the markup', async () => {
    const em = orm.em.fork();
    const doc = await makeDraft(em);
    await asA(() => documents.setFieldValues(doc, [{ formFieldId: field['new_salary'], value: '7500000' }]));
    const row = await orm.em
      .fork()
      .findOneOrFail(DocFieldValue, { document: doc, formField: field['new_salary'] }, FILTER_OFF);
    // What the promotion post-action's /^\d+(\.\d+)?$/ guard will see.
    expect(row.fieldValue).toBe('7500000');
    expect(carriesMarkup(row.fieldValue)).toBe(false);
  });

  it('refuses a job level outside the company ladder', async () => {
    const em = orm.em.fork();
    const doc = await makeDraft(em);
    await expect(
      asA(() => documents.setFieldValues(doc, [{ formFieldId: field['new_job_level'], value: 'WIZARD' }])),
    ).rejects.toThrow(/new_job_level/);
  });

  it('keeps the rich editor for the fields that want one', async () => {
    const em = orm.em.fork();
    const memo = await em.findOneOrFail(DocumentType, { code: 'MEMO', company: companyA }, FILTER_OFF);
    const tmpl = await em.findOneOrFail(FormTemplate, { documentType: memo.id }, FILTER_OFF);
    const reason = await em.findOneOrFail(FormField, { formTemplate: tmpl.id, fieldName: 'reason' }, FILTER_OFF);
    expect(isHtmlFieldType(reason.fieldType)).toBe(true);
  });
});

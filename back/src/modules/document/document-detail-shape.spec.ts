import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocCategory } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { AccountService } from '../accounting/account.service';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetService } from '../budget/budget.service';
import { Currency } from '../currency/currency.entities';
import { ItemService } from '../master-data/item.service';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { AppUser } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DeptDocType, DocumentType, FormTemplate } from './document.entities';
import { DocumentService } from './document.service';
import { NumberingService } from './numbering.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

/**
 * The detail read is what the document screen renders from, and two of its gates key off WHO
 * created the document: "cancel your own" and the self-approval mirror. Both read
 * `document.createdBy.id`. An unpopulated MikroORM relation serializes as a bare id STRING, so
 * `.id` on it is undefined, every comparison is false, and the cancel button silently never
 * renders — no error anywhere to notice. This pins the shape the client reads.
 */
describe.skipIf(!hasDb)('document detail read shape (DB-backed)', () => {
  let orm: MikroORM;
  let documents: DocumentService;
  const ids = { company: '', dept: '', docType: '', user: '' };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const em = orm.em.fork();
    const lak = em.create(Currency, { code: 'LAK', name: 'Kip', decimalPlaces: 0, isActive: true });
    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: lak, isActive: true });
    const dept = em.create(Department, { company, deptCode: 'DA', name: 'DA', isActive: true });
    const y = new Date().getUTCFullYear();
    em.create(FiscalYear, { company, year: y, startDate: `${y}-01-01`, endDate: `${y}-12-31`, status: 'OPEN' });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    // The creator carries a password hash, so the read is also the place to prove the hash never
    // rides along with the user it populates.
    const user = em.create(AppUser, { username: 'raiser', email: 'raiser@x', status: 'ACTIVE', passwordHash: '$2a$10$notarealhash' });
    const docType = em.create(DocumentType, { company, code: 'MEMO', name: 'Memo', category: DocCategory.ADMIN, requiresBudget: false, requiresQuota: false, isActive: true });
    const tmpl = em.create(FormTemplate, { documentType: docType, version: 1, status: 'PUBLISHED' });
    em.create(DeptDocType, { department: dept, documentType: docType, formTemplate: tmpl, workflow: wf, isActive: true });

    await em.flush();
    Object.assign(ids, { company: company.id, dept: dept.id, docType: docType.id, user: user.id });
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
      orm.em,
      scope,
      new DeptDocTypeService(orm.em),
      new NumberingService(orm.em),
      new ItemService(orm.em, scope, new ScopeService(), accounts),
      new BudgetService(orm.em, accounts, new BudgetBalanceService(orm.em)),
      new FiscalYearService(scope),
    );
  });

  const asCreator = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: ids.user, companyId: ids.company, departmentId: ids.dept, grants: [] }, fn);

  it('identifies the creator by id AND username, never as a bare id string', async () => {
    const draft = await asCreator(() => documents.createDraft({ documentTypeId: ids.docType }));
    const { document } = await asCreator(() => documents.detail(draft.id));

    const createdBy = document.createdBy as { id: string; username: string };
    // The shape, not merely the value: `typeof createdBy === 'string'` is exactly the regression.
    expect(createdBy).toEqual({ id: ids.user, username: 'raiser' });
    expect(createdBy.id).toBe(ids.user);
  });

  it('narrows the creator to id + username — no email, no credentials', async () => {
    const draft = await asCreator(() => documents.createDraft({ documentTypeId: ids.docType }));
    const { document } = await asCreator(() => documents.detail(draft.id));

    // Every DOC_VIEW holder in the company reads this. The creator's email, verification state
    // and password hash are none of their business.
    expect(Object.keys(document.createdBy as object).sort()).toEqual(['id', 'username']);
    expect(JSON.stringify(document)).not.toContain('notarealhash');
  });
});

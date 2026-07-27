import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocCategory, DocStatus } from '../../common/enums';
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
import { AttachmentService } from './attachment.service';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentService } from './document.service';
import { NumberingService } from './numbering.service';
import {
  DeptDocType, DocFieldValue, Document, DocumentCategory, DocumentLine, DocumentType, FormField,
  FormTemplate,
} from './document.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;
const G = { userId: '' };

/**
 * What an approver signed is what takes effect.
 *
 * `setPayee` has always been DRAFT-only, and its comment gives the reason — the destination that
 * passed the approval chain is the one that gets paid. The same reasoning was never applied to the
 * document's own contents, so the amounts and the justification an approver read could be rewritten
 * afterwards, leaving an approval_log describing a document that no longer exists.
 */
describe.skipIf(!hasDb)('a submitted document is frozen (DB-backed)', () => {
  let orm: MikroORM;
  let documents: DocumentService;
  let attachments: AttachmentService;
  const ids = { companyA: '', deptA: '', dt: '', tmpl: '', wf: '', field: '' };

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
    const field = em.create(FormField, {
      formTemplate: tmpl, fieldName: 'reason', fieldLabel: 'Reason', fieldType: 'text',
      isRequired: false, sortOrder: 1,
    } as never);
    em.create(DeptDocType, { department: dept, documentType: dt, formTemplate: tmpl, workflow: wf, isActive: true });
    await em.flush();
    G.userId = user.id;
    Object.assign(ids, {
      companyA: company.id, deptA: dept.id, dt: dt.id, tmpl: tmpl.id, wf: wf.id, field: field.id,
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
    const items = new ItemService(orm.em, scope, new ScopeService(), accounts);
    documents = new DocumentService(
      orm.em, scope, new DeptDocTypeService(orm.em), new NumberingService(orm.em), items,
      new BudgetService(orm.em, accounts), new FiscalYearService(scope),
    );
    attachments = new AttachmentService(orm.em, scope, null as never);
  });

  const asUser = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: G.userId, companyId: ids.companyA, departmentId: ids.deptA, grants: [] }, fn);

  /** A draft carrying one field value and one line, then forced to `status`. */
  async function documentAt(status: DocStatus) {
    const doc = await asUser(() =>
      documents.createDraft({
        documentTypeId: ids.dt,
        fieldValues: [{ formFieldId: ids.field, value: 'original reason' }],
        lines: [{ lineNo: 1, description: 'original line', qty: '1', unitPrice: '100', lineAmount: '100' }],
      } as never),
    );
    if (status !== DocStatus.DRAFT) {
      const em = orm.em.fork();
      const stored = await em.findOneOrFail(Document, { id: doc.id }, FILTER_OFF);
      stored.status = status;
      await em.flush();
    }
    return doc.id;
  }

  const fieldValue = async (documentId: string) =>
    (await orm.em.fork().findOne(DocFieldValue, { document: documentId }, FILTER_OFF))?.fieldValue;
  const lineDescription = async (documentId: string) =>
    (await orm.em.fork().findOne(DocumentLine, { document: documentId }, FILTER_OFF))?.description;

  it('refuses a field write under approval and leaves the stored value alone', async () => {
    const id = await documentAt(DocStatus.IN_APPROVAL);

    await expect(
      asUser(() => documents.setFieldValues(id, [{ formFieldId: ids.field, value: 'rewritten' }])),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_STATE });

    // Asserted on the stored value, not only on the throw: a guard that rejected AFTER writing
    // would satisfy a throw-only test while leaving the damage done.
    expect(await fieldValue(id)).toBe('original reason');
  });

  it('refuses a line write after approval and leaves the stored lines alone', async () => {
    const id = await documentAt(DocStatus.COMPLETED);

    await expect(
      asUser(() =>
        documents.setLines(id, [
          { lineNo: 1, description: 'rewritten', qty: '1', unitPrice: '99999', lineAmount: '99999' },
        ] as never),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_STATE });

    expect(await lineDescription(id)).toBe('original line');
  });

  it('still accepts both writes on a draft', async () => {
    // The regression guard for the whole create-and-edit flow the web app uses.
    const id = await documentAt(DocStatus.DRAFT);

    await asUser(() => documents.setFieldValues(id, [{ formFieldId: ids.field, value: 'edited' }]));
    await asUser(() =>
      documents.setLines(id, [
        { lineNo: 1, description: 'edited line', qty: '2', unitPrice: '50', lineAmount: '100' },
      ] as never),
    );

    expect(await fieldValue(id)).toBe('edited');
    expect(await lineDescription(id)).toBe('edited line');
  });

  it('accepts writes again once a document is returned to DRAFT', async () => {
    // Returning is what an approver does instead of rejecting, and it is the supported way to
    // change a submitted document — at the cost of the whole chain approving again.
    const id = await documentAt(DocStatus.IN_APPROVAL);
    const em = orm.em.fork();
    const stored = await em.findOneOrFail(Document, { id }, FILTER_OFF);
    stored.status = DocStatus.DRAFT;
    await em.flush();

    await asUser(() => documents.setFieldValues(id, [{ formFieldId: ids.field, value: 'fixed' }]));
    expect(await fieldValue(id)).toBe('fixed');
  });

  it('still allows an attachment while the document waits for a signature', async () => {
    // Deliberately not frozen: an approver asking for another photo is part of deciding, and
    // evidence added later cannot change what the document says.
    const id = await documentAt(DocStatus.IN_APPROVAL);
    await expect(asUser(() => attachments.list(id))).resolves.toBeDefined();
  });
});

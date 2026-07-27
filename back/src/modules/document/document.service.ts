import { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { coded, ErrorCode } from '../../common/errors/error-code';
import type { FilterQuery } from '@mikro-orm/core';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { paginate, type Paginated } from '../../common/pagination/pagination';
import { DocStatus } from '../../common/enums';
import { Budget } from '../budget/budget.entities';
import { BudgetService } from '../budget/budget.service';
import { TaxCode } from '../tax/tax.entities';
import { Currency } from '../currency/currency.entities';
import { Item, Vendor, VendorBankAccount } from '../master-data/master-data.entities';
import { ItemService } from '../master-data/item.service';
import { Company, Department } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { AppUser, Employee } from '../rbac/rbac.entities';
import { Workflow } from '../approval/approval.entities';
import { Warehouse } from '../inventory/inventory.entities';
import { DeptDocTypeService } from './dept-doc-type.service';
import {
  DeptDocType,
  DocFieldValue,
  Document,
  DocumentAttachment,
  DocumentLine,
  DocumentType,
  FormField,
  FormTemplate,
} from './document.entities';
import { NumberingService } from './numbering.service';
import { isRefPairingAllowed } from './ref-chain.config';
import type {
  CreateDocumentDto,
  DocumentLineInput,
  DocumentListQueryDto,
  FieldValueInput,
} from './dto/document.dto';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Build the document-list `where` from the optional filters. Returned conditions only
 * narrow within the already-applied company scope. `createdTo` is treated as inclusive of
 * the end day; amount bounds stay decimal strings so Postgres compares them numerically
 * against `decimal(15,2)` with no JS-number round-trip.
 */
export function buildDocumentFilter(q: DocumentListQueryDto): FilterQuery<Document> {
  const where: Record<string, unknown> = {};
  if (q.status?.length) where.status = { $in: q.status };
  if (q.documentTypeId) where.documentType = q.documentTypeId;
  if (q.departmentId) where.department = q.departmentId;
  if (q.vendorId) where.vendor = q.vendorId;
  if (q.docNo) where.docNo = { $ilike: `%${q.docNo}%` };

  const createdAt: Record<string, Date> = {};
  if (q.createdFrom) createdAt.$gte = new Date(q.createdFrom);
  if (q.createdTo) createdAt.$lte = endOfDayInclusive(q.createdTo);
  if (Object.keys(createdAt).length) where.createdAt = createdAt;

  const amount: Record<string, string> = {};
  if (q.minAmount != null) amount.$gte = q.minAmount;
  if (q.maxAmount != null) amount.$lte = q.maxAmount;
  if (Object.keys(amount).length) where.baseTotalAmount = amount;

  return where as FilterQuery<Document>;
}

/** A date-only `YYYY-MM-DD` becomes end-of-day (inclusive); a full timestamp is used as-is. */
function endOfDayInclusive(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59.999Z`) : new Date(value);
}

/**
 * A dropdown's stored options as an array of strings, or undefined if the row cannot be read as
 * one. Validation on write already rejects anything else, so a bad value here means a row written
 * before that validation or edited outside the app — a reason to omit the options, not to fail a
 * read that the caller needs for everything else on the form.
 */
function parseOptions(optionsJson: string): string[] | undefined {
  try {
    const parsed: unknown = JSON.parse(optionsJson);
    return Array.isArray(parsed) && parsed.every((o) => typeof o === 'string') ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Runtime documents: create draft (resolve mapping, issue number, ref chain), content. */
@Injectable()
export class DocumentService {
  constructor(
    private readonly em: EntityManager,
    private readonly scope: CompanyScopeService,
    private readonly deptDocTypes: DeptDocTypeService,
    private readonly numbering: NumberingService,
    private readonly items: ItemService,
    private readonly budgets: BudgetService,
    private readonly fiscalYears: FiscalYearService,
  ) {}

  async createDraft(dto: CreateDocumentDto): Promise<Document> {
    const companyId = RequestContext.companyId()!;
    const departmentId = RequestContext.departmentId()!;
    const userId = RequestContext.userId()!;
    const em = this.em.fork();

    // A create naming an external source it already made is a retry, not a second document.
    // Answered here, at the top, and specifically BEFORE numbering.next(): that call commits its
    // increment in its own transaction, so a duplicate caught any later would already have spent a
    // document number on nothing. The stored document is returned untouched — a retry is by
    // definition the same request, and applying its payload to a document that may already be
    // submitted or approved would be far worse than ignoring it.
    if (dto.sourceType && dto.sourceId) {
      const existing = await this.findBySource(em, companyId, dto.sourceType, dto.sourceId);
      if (existing) return existing;
    }

    // Pin the department's form template + workflow for this type.
    const mapping = await this.deptDocTypes.resolve(departmentId, dto.documentTypeId);
    const company = await em.findOne(Company, { id: companyId }, { populate: ['baseCurrency'] });
    // The document type must belong to the active company (invariant 1) — a type of another
    // company is treated as not found.
    const docType = await em.findOne(DocumentType, { id: dto.documentTypeId }, FILTER_OFF);
    if (!company || !docType || docType.company.id !== companyId) {
      throw new NotFoundException('Company or document type not found');
    }

    // Validate the reference chain before issuing a number: the predecessor must live in
    // the active company, be APPROVED/COMPLETED, and form a permitted type pairing.
    if (dto.refDocumentId) await this.assertPredecessor(dto.refDocumentId, docType);

    const year = new Date().getUTCFullYear();
    const prefix = NumberingService.buildPrefix(docType.code, company.code, year);
    const docNo = await this.numbering.next(companyId, dto.documentTypeId, year, prefix);

    const document = em.create(Document, {
      docNo,
      company: em.getReference(Company, companyId),
      department: em.getReference(Department, departmentId),
      documentType: em.getReference(DocumentType, dto.documentTypeId),
      formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id),
      currentStepNo: 0,
      createdBy: em.getReference(AppUser, userId),
      refDocument: dto.refDocumentId ? em.getReference(Document, dto.refDocumentId) : undefined,
      relatedEmployee: dto.relatedEmployeeId ? em.getReference(Employee, dto.relatedEmployeeId) : undefined,
      vendor: dto.vendorId ? em.getReference(Vendor, dto.vendorId) : undefined,
      vendorBankAccount: dto.vendorBankAccountId
        ? em.getReference(VendorBankAccount, dto.vendorBankAccountId)
        : undefined,
      // Stored as given; validated at submit against the active company's active warehouses,
      // alongside the other config-driven completeness gates. A draft may be incomplete.
      warehouse: dto.warehouseId ? em.getReference(Warehouse, dto.warehouseId) : undefined,
      destWarehouse: dto.destWarehouseId
        ? em.getReference(Warehouse, dto.destWarehouseId)
        : undefined,
      currency: dto.currency ? await this.requireCurrency(em, dto.currency) : undefined,
      exchangeRate: '1',
      totalAmount: dto.totalAmount,
      status: DocStatus.DRAFT,
      createdAt: new Date(),
      sourceType: dto.sourceType,
      sourceId: dto.sourceId,
    });
    em.persist(document);

    if (dto.fieldValues?.length) await this.writeFieldValues(em, document, dto.fieldValues);
    if (dto.lines?.length) await this.writeLines(em, document, dto.lines, docType);

    try {
      await em.flush();
    } catch (e) {
      // Two retries that both passed the lookup above; the partial unique index let exactly one
      // through. The loser re-reads and hands back the winner's document, because its caller asked
      // for the same thing and deserves the same answer — not a 500. Its document number is spent,
      // which is the narrow cost of not holding the numbering lock across the whole create.
      if (e instanceof UniqueConstraintViolationException && dto.sourceType && dto.sourceId) {
        const winner = await this.findBySource(this.em.fork(), companyId, dto.sourceType, dto.sourceId);
        if (winner) return winner;
      }
      throw e;
    }
    return document;
  }

  /** The document already recorded for an external source in this company, if there is one. */
  private findBySource(
    em: EntityManager,
    companyId: string,
    sourceType: string,
    sourceId: string,
  ): Promise<Document | null> {
    return em.findOne(Document, { company: companyId, sourceType, sourceId }, FILTER_OFF);
  }

  /**
   * Create a DRAFT successor from an approved predecessor (PR→PO, advance→clear-advance),
   * copying the predecessor's header and line items. Validation (active company, predecessor
   * status, type pairing) is enforced by createDraft via assertPredecessor; the copy creates
   * no budget/quota holds — those are taken at the successor's own submit.
   */
  async createFrom(refId: string, documentTypeId: string): Promise<Document> {
    const scoped = this.scope.forActiveCompany();
    const predecessor = await scoped.findOne(
      Document,
      { id: refId },
      { populate: ['currency', 'vendor', 'relatedEmployee'] },
    );
    if (!predecessor) throw new NotFoundException(`Document ${refId} not found`);
    const lines = await scoped.find(
      DocumentLine,
      { document: refId },
      { orderBy: { lineNo: 'ASC' }, populate: ['item', 'budget', 'taxCode'] },
    );
    return this.createDraft({
      documentTypeId,
      refDocumentId: refId,
      currency: predecessor.currency?.code,
      vendorId: predecessor.vendor?.id,
      relatedEmployeeId: predecessor.relatedEmployee?.id,
      totalAmount: predecessor.totalAmount,
      // GL is not copied: it is re-derived from the item (or the chosen budget) on write, so
      // the successor always reflects the current item/budget config, not a stale stamp.
      lines: lines.map((l) => ({
        lineNo: l.lineNo,
        itemId: l.item?.id,
        description: l.description,
        qty: l.qty,
        unit: l.unit,
        unitPrice: l.unitPrice,
        lineAmount: l.lineAmount,
        budgetId: l.budget?.id,
        // The VAT treatment is part of the line, like its budget: the same purchase invoiced down
        // the chain carries the same tax code. Dropping it made the successor's grand total (and
        // the Input VAT posted at payment) silently smaller than the predecessor's.
        taxCodeId: l.taxCode?.id,
      })),
    });
  }

  /** Resolve a predecessor in the active company and enforce the reference-chain rules. */
  private async assertPredecessor(refId: string, successorType: DocumentType): Promise<void> {
    const scoped = this.scope.forActiveCompany();
    const companyId = RequestContext.companyId()!;
    const predecessor = await scoped.findOne(
      Document,
      { id: refId },
      { populate: ['documentType'] },
    );
    // Cross-company (or missing) predecessor: not-found, never a cross-company link.
    if (!predecessor) throw new NotFoundException(`Document ${refId} not found`);
    if (predecessor.status !== DocStatus.APPROVED && predecessor.status !== DocStatus.COMPLETED) {
      throw new BadRequestException('Referenced document must be approved');
    }
    // The pairing must be configured for the active company (document_type_ref). Resolve by
    // type ids — both types are loaded, so no reliance on a populated type's `code`.
    const allowed = await isRefPairingAllowed(
      scoped,
      companyId,
      predecessor.documentType.id,
      successorType.id,
    );
    if (!allowed) {
      throw new BadRequestException(
        `Cannot create ${successorType.code} from ${predecessor.documentType.code}`,
      );
    }
  }

  async setFieldValues(documentId: string, values: FieldValueInput[]): Promise<void> {
    const em = this.scope.forActiveCompany();
    const document = await this.getWith(em, documentId);
    this.assertEditable(document);
    await this.writeFieldValues(em, document, values);
    await em.flush();
  }

  /**
   * Re-point a DRAFT document's payee.
   *
   * DRAFT only: the destination that passed the approval chain is the destination that gets paid,
   * so once the document is submitted nobody — including finance — may redirect it. Returning a
   * document to DRAFT is the only supported way to change the payee, and it costs a fresh trip
   * through every approval step, which is the point.
   */
  async setPayee(documentId: string, vendorBankAccountId: string | null): Promise<void> {
    const em = this.scope.forActiveCompany();
    const document = await this.getWith(em, documentId);
    if (document.status !== DocStatus.DRAFT) {
      throw new BadRequestException(
        'The payee can only be changed while the document is a draft — return it first',
      );
    }
    if (!vendorBankAccountId) {
      document.vendorBankAccount = undefined;
      await em.flush();
      return;
    }
    // Validated fully at submit; here we only refuse an account of a different vendor outright, so
    // a wrong pick fails at the moment it is made rather than at submit.
    const account = await em.findOne(
      VendorBankAccount,
      { id: vendorBankAccountId },
      { populate: ['vendor'], ...FILTER_OFF },
    );
    if (!account) throw new NotFoundException(`Vendor bank account ${vendorBankAccountId} not found`);
    if (!document.vendor || account.vendor.id !== document.vendor.id) {
      throw new BadRequestException("The payee bank account does not belong to this document's vendor");
    }
    document.vendorBankAccount = account;
    await em.flush();
  }

  /** Replace the document's lines. DRAFT only — see assertEditable. */
  async setLines(documentId: string, lines: DocumentLineInput[]): Promise<void> {
    const em = this.scope.forActiveCompany();
    const document = await this.getWith(em, documentId);
    this.assertEditable(document);
    // Load the type flags so line writing can derive GL / resolve budget config-driven.
    const docType = await em.findOneOrFail(DocumentType, { id: document.documentType.id }, FILTER_OFF);
    await em.nativeDelete(DocumentLine, { document: documentId });
    await this.writeLines(em, document, lines, docType);
    await em.flush();
  }

  list(q: DocumentListQueryDto = {}): Promise<Paginated<Document>> {
    // forActiveCompany() returns a forked em with the company filter applied, so the
    // scope stays in the (auto-applied) where; the built filter only narrows within it
    // and paging adds the window. A cross-company filter value simply matches no rows.
    return paginate(
      this.scope.forActiveCompany(),
      Document,
      buildDocumentFilter(q),
      { orderBy: { createdAt: 'DESC' } },
      q,
    );
  }

  get(id: string): Promise<Document> {
    return this.getWith(this.scope.forActiveCompany(), id);
  }

  /**
   * Full detail read for a single document, scoped to the active company: the document
   * header plus its field values, line items, attachment metadata, and predecessor
   * reference (doc_no + status) so the client can render the whole document.
   */
  async detail(id: string): Promise<{
    document: Document;
    fieldValues: Array<{ formFieldId: string; fieldName: string; fieldLabel: string; fieldType: string; value?: string }>;
    lines: DocumentLine[];
    attachments: DocumentAttachment[];
    refDocument: { id: string; docNo: string; status: DocStatus } | null;
  }> {
    const em = this.scope.forActiveCompany();
    const document = await em.findOne(
      Document,
      { id },
      // vendorBankAccount is populated so an approver can see where the money lands before
      // approving, rather than trusting the destination implicitly.
      { populate: ['refDocument', 'documentType', 'vendor', 'vendorBankAccount', 'currency'] },
    );
    if (!document) throw new NotFoundException(`Document ${id} not found`);
    const values = await em.find(DocFieldValue, { document: id });
    // Map values onto their field's metadata (label/type) so the client can render them,
    // ordered by the template's field sort order.
    const fields = await em.find(
      FormField,
      { formTemplate: document.formTemplate.id },
      { orderBy: { sortOrder: 'ASC' }, filters: { company: false } },
    );
    const valueByFieldId = new Map(values.map((v) => [v.formField.id, v.fieldValue]));
    const fieldValues = fields
      .filter((f) => valueByFieldId.has(f.id))
      .map((f) => ({
        formFieldId: f.id,
        fieldName: f.fieldName,
        fieldLabel: f.fieldLabel,
        fieldType: f.fieldType,
        value: valueByFieldId.get(f.id),
      }));
    const lines = await em.find(
      DocumentLine,
      { document: id },
      { orderBy: { lineNo: 'ASC' }, populate: ['item', 'budget'] },
    );
    const attachments = await em.find(
      DocumentAttachment,
      { document: id },
      { orderBy: { uploadedAt: 'ASC' } },
    );
    return {
      document,
      fieldValues,
      lines,
      attachments,
      refDocument: document.refDocument
        ? { id: document.refDocument.id, docNo: document.refDocument.docNo, status: document.refDocument.status }
        : null,
    };
  }

  /** Document types the active department may create (for a DOC_CREATE requester). */
  async listCreatableTypes(): Promise<
    Array<{ id: string; code: string; name: string; category: string; requiresBudget: boolean; requiresQuota: boolean; requiresVendor: boolean; requiresItem: boolean; requiresPayee: boolean; defaultGlAccount?: string }>
  > {
    const departmentId = RequestContext.departmentId()!;
    const em = this.em.fork();
    // Resolve DocumentType rows explicitly by id instead of `populate: ['documentType']`.
    // The shared root EM can hold DocumentType as an unloaded reference after a prior
    // create/submit flow (which loads DeptDocType without populating its documentType),
    // so a populated relation would come back with `isActive` undefined and every row
    // would be silently dropped by the isActive filter. An id-scoped load always
    // hydrates the entities. Mirrors the batch-by-id pattern in DeptDocTypeService.
    const mappings = await em.find(
      DeptDocType,
      { department: departmentId, isActive: true },
      FILTER_OFF,
    );
    const typeIds = [...new Set(mappings.map((m) => m.documentType.id))];
    const types = typeIds.length
      ? await em.find(DocumentType, { id: { $in: typeIds }, isActive: true }, FILTER_OFF)
      : [];
    return types.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      category: t.category,
      requiresBudget: t.requiresBudget,
      requiresQuota: t.requiresQuota,
      requiresVendor: t.requiresVendor,
      requiresItem: t.requiresItem,
      // Drives the payee picker on the form. A hand-built projection silently drops a new flag —
      // the form then renders as if the type never required a payee, and the first anyone hears of
      // it is the server refusing the submit.
      requiresPayee: t.requiresPayee,
      defaultGlAccount: t.defaultGlAccount,
    }));
  }

  /** The form fields of a creatable type's mapped template, for rendering. */
  async formForType(documentTypeId: string): Promise<{
    documentTypeId: string;
    formTemplateId: string;
    version: number;
    fields: Array<{
      id: string; fieldName: string; fieldLabel: string; fieldType: string;
      isRequired: boolean; sortOrder: number; options?: string[];
    }>;
  }> {
    /** The `options` key, present only when there is something readable to put in it. */
    const options = (raw?: string): { options?: string[] } => {
      const parsed = raw ? parseOptions(raw) : undefined;
      return parsed ? { options: parsed } : {};
    };
    const departmentId = RequestContext.departmentId()!;
    const mapping = await this.deptDocTypes.resolve(departmentId, documentTypeId);
    const template = mapping.formTemplate;
    const fields = await this.em.find(
      FormField,
      { formTemplate: template.id },
      { orderBy: { sortOrder: 'ASC' }, ...FILTER_OFF },
    );
    return {
      documentTypeId,
      formTemplateId: template.id,
      version: template.version,
      fields: fields.map((f) => ({
        id: f.id,
        fieldName: f.fieldName,
        fieldLabel: f.fieldLabel,
        fieldType: f.fieldType,
        isRequired: f.isRequired,
        sortOrder: f.sortOrder,
        // A dropdown whose permitted values cannot be read is half a contract: the caller is told
        // to render a choice and left to guess what the choices are, or to hardcode them from a
        // document that will drift. Parsed here rather than passed through raw so a caller reads
        // an array, and so a malformed row degrades to "no options" instead of breaking the read.
        ...options(f.optionsJson),
      })),
    };
  }

  private async writeFieldValues(
    em: EntityManager,
    document: Document,
    values: FieldValueInput[],
  ): Promise<void> {
    for (const v of values) {
      let row = await em.findOne(
        DocFieldValue,
        { document: document.id, formField: v.formFieldId },
        FILTER_OFF,
      );
      if (row) {
        row.fieldValue = v.value;
      } else {
        row = em.create(DocFieldValue, {
          document,
          formField: em.getReference(FormField, v.formFieldId),
          fieldValue: v.value,
        });
        em.persist(row);
      }
    }
  }

  /**
   * Persist a document's lines, deriving each line's GL and budget server-side (invariant 7).
   * The requester picks the item, never a GL code:
   *  - item-backed line → GL is the item's `default_gl_account` (client GL is never trusted).
   *    On a `requires_budget` type the budget is resolved from that GL + the document's
   *    department + the fiscal year covering the document date; a missing GL or an
   *    unresolved budget is rejected with a specific error.
   *  - item-less line → the requester's chosen `budgetId` is the fallback, and the line's GL
   *    rides on that budget's GL.
   */
  private async writeLines(
    em: EntityManager,
    document: Document,
    lines: DocumentLineInput[],
    docType: DocumentType,
  ): Promise<void> {
    // Document date pins the fiscal year for budget resolution (design: locked at submit,
    // resolved from the document date here). createdAt is set before writeLines runs.
    const docDate = (document.createdAt ?? new Date()).toISOString().slice(0, 10);
    for (const l of lines) {
      const { glAccount, budget } = await this.resolveLineGlAndBudget(em, document, docType, l, docDate);
      em.persist(
        em.create(DocumentLine, {
          document,
          lineNo: l.lineNo,
          item: l.itemId ? em.getReference(Item, l.itemId) : undefined,
          description: l.description,
          qty: l.qty,
          unit: l.unit,
          unitPrice: l.unitPrice,
          lineAmount: l.lineAmount,
          budget,
          taxCode: l.taxCodeId ? em.getReference(TaxCode, l.taxCodeId) : undefined,
          glAccount,
          receivedQty: '0',
          lineStatus: 'OPEN',
        }),
      );
    }
  }

  /** Server-authoritative GL + budget for one line — see {@link writeLines}. */
  private async resolveLineGlAndBudget(
    em: EntityManager,
    document: Document,
    docType: DocumentType,
    line: DocumentLineInput,
    docDate: string,
  ): Promise<{ glAccount?: string; budget?: Budget }> {
    if (line.itemId) {
      const itemGl = (await this.items.defaultGlAccountFor(line.itemId)) ?? undefined;
      if (!docType.requiresBudget) return { glAccount: itemGl };
      if (!itemGl) {
        throw new BadRequestException(
          `Item ${line.itemId} has no default GL account; a budget cannot be resolved for a budget-controlled document`,
        );
      }
      const fy = await this.fiscalYears.resolveOpenPeriod(docDate);
      const resolved = await this.budgets.resolveSelectable({
        glAccount: itemGl,
        departmentId: document.department.id,
        fiscalYearId: fy.id,
      });
      if (!resolved) {
        throw new BadRequestException(
          `No active budget for GL ${itemGl}, department ${document.department.id}, fiscal year ${fy.year}`,
        );
      }
      return { glAccount: itemGl, budget: em.getReference(Budget, resolved.id) };
    }
    // Item-less line — precedence: explicit budget → type default GL → nothing.
    // (1) An explicitly chosen budget wins and stamps the GL from that budget.
    if (line.budgetId) {
      const budget = await em.findOne(Budget, { id: line.budgetId }, FILTER_OFF);
      return { glAccount: budget?.glAccount, budget: em.getReference(Budget, line.budgetId) };
    }
    // (2) Otherwise, when the type sets a default GL, stamp it and resolve the budget
    // best-effort: an ACTIVE match is charged; no match leaves the budget unset (NOT rejected,
    // unlike an item-backed line — the submit-time coverage rule still guards a positive line).
    if (docType.defaultGlAccount) {
      const glAccount = docType.defaultGlAccount;
      if (!docType.requiresBudget) return { glAccount };
      const fy = await this.fiscalYears.resolveOpenPeriod(docDate);
      const resolved = await this.budgets.resolveSelectable({
        glAccount,
        departmentId: document.department.id,
        fiscalYearId: fy.id,
      });
      return { glAccount, budget: resolved ? em.getReference(Budget, resolved.id) : undefined };
    }
    // (3) No item, no chosen budget, no type default → nothing derived.
    return {};
  }

  private async requireCurrency(em: EntityManager, code: string): Promise<Currency> {
    const currency = await em.findOne(Currency, { code: code.toUpperCase() });
    if (!currency) throw new NotFoundException(`Currency '${code}' not found`);
    return currency;
  }

  /**
   * A document's contents are editable only while it is a DRAFT.
   *
   * The same rule, and the same reason, as the payee: what an approver signed is what takes
   * effect. Rewriting the lines or the field values of a document under approval leaves an
   * `approval_log` saying somebody approved something, beside a document that no longer says what
   * they approved.
   *
   * Returning a document to DRAFT is the supported way to change one — and it costs a fresh trip
   * through every approval step, which is the point rather than the inconvenience.
   *
   * Guarded here rather than in the controller so a second caller written later inherits it.
   */
  private assertEditable(document: Document): void {
    if (document.status !== DocStatus.DRAFT) {
      throw coded(
        ErrorCode.INVALID_STATE,
        `A ${document.status} document cannot be edited — return it to DRAFT first, which costs a ` +
          'fresh trip through every approval step',
      );
    }
  }

  private async getWith(em: EntityManager, id: string): Promise<Document> {
    const document = await em.findOne(Document, { id });
    if (!document) throw new NotFoundException(`Document ${id} not found`);
    return document;
  }
}

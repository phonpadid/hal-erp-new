import { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException, wrap } from '@mikro-orm/core';
import { coded, ErrorCode } from '../../common/errors/error-code';
import type { FilterQuery } from '@mikro-orm/core';
import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { carriesMarkup, isHtmlFieldType } from '@erp/shared';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { paginate, type Paginated } from '../../common/pagination/pagination';
import { DocStatus } from '../../common/enums';
import { Money } from '../../common/money/money';
import { Budget } from '../budget/budget.entities';
import { BudgetService } from '../budget/budget.service';
import { TaxCode } from '../tax/tax.entities';
import { Currency } from '../currency/currency.entities';
import { Item, Vendor, VendorBankAccount } from '../master-data/master-data.entities';
import { ItemService } from '../master-data/item.service';
import { VendorService } from '../master-data/vendor.service';
import { Company, Department } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { AppUser, Employee } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import {
  ApprovalDelegation,
  ApprovalLog,
  DocumentApprovalStep,
  DocumentApprovalStepActor,
  Workflow,
} from '../approval/approval.entities';
import { Warehouse } from '../inventory/inventory.entities';
import { WarehouseService } from '../inventory/warehouse.service';
import { Payment, PaymentAttachment } from '../payment-handoff/payment.entities';
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
import { DocumentPermissions as P } from './permissions';
import { isRefPairingAllowed } from './ref-chain.config';
import type {
  CreateDocumentDto,
  DocumentLineInput,
  DocumentListQueryDto,
  FieldValueInput,
  SetSelectionsDto,
} from './dto/document.dto';

const FILTER_OFF = { filters: { company: false } } as const;

/** An empty `$in` compiles to `1 = 0`: a refusal Postgres understands, rather than a bad uuid. */
const MATCHES_NOTHING = { id: { $in: [] as string[] } } as const;

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
  // "Only the ones I raised" — the reader's own choice, narrowing whatever they are allowed to see.
  // A filter, never a grant: what a person MAY see is an administrator's decision and must not be
  // bypassable, while what they WANT to see right now changes through the day and must be.
  if (q.mine) where.createdBy = RequestContext.userId();

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
  /**
   * Stateless and dependency-free — it only reads the grants off `RequestContext` — so it is built
   * here rather than injected. Dozens of specs construct this service positionally, and adding a
   * required constructor parameter to reach a class with no dependencies of its own would break
   * every one of them to express nothing.
   */
  private readonly scopes = new ScopeService();

  constructor(
    private readonly em: EntityManager,
    private readonly scope: CompanyScopeService,
    private readonly deptDocTypes: DeptDocTypeService,
    private readonly numbering: NumberingService,
    private readonly items: ItemService,
    private readonly budgets: BudgetService,
    private readonly fiscalYears: FiscalYearService,
    // Optional to construct, REQUIRED to correct a draft's selections. Every other method predates
    // them and dozens of unit tests build this service positionally, so making them required would
    // break call sites that never touch a warehouse or a vendor. `setSelections` asks for them and
    // fails loudly if they are absent, which is a wiring bug rather than a reachable state.
    @Optional() private readonly warehouses?: WarehouseService,
    @Optional() private readonly vendors?: VendorService,
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
  /**
   * Record the supplier's tax invoice on a draft.
   *
   * DRAFT-only for the same reason the payee is: the invoice a document claims against is part of
   * what the approvers saw. Its own endpoint rather than a general update, because the document
   * service has no general update — fields, lines and payee each have theirs, and a purchase's
   * invoice is not a form field: it is required by the tax it carries, not by the template.
   */
  async setVendorInvoice(
    documentId: string,
    invoiceNo: string | null,
    invoiceDate: string | null,
  ): Promise<void> {
    const em = this.scope.forActiveCompany();
    const document = await this.getWith(em, documentId);
    if (document.status !== DocStatus.DRAFT) {
      throw new BadRequestException(
        'The supplier invoice can only be changed while the document is a draft — return it first',
      );
    }
    document.vendorInvoiceNo = invoiceNo?.trim() || undefined;
    document.vendorInvoiceDate = invoiceDate || undefined;
    await em.flush();
  }

  /**
   * Correct the selections a draft's TYPE asks for: warehouse, destination warehouse, related
   * employee, vendor.
   *
   * These four were write-once at creation, and the submit gates require them when the type sets
   * `requires_warehouse`, `TRANSFER_STOCK`, `requires_employee` or `requires_vendor`. A draft
   * missing one could therefore never be finished and never be fixed — the wizard showed the field
   * blank, disabled and required at once. A type can also GAIN one of those flags after its drafts
   * exist (`DocumentTypeService.update` assigns them freely and submit reads them live), which
   * strands every draft of that type at a stroke, through no act of their authors.
   *
   * DRAFT only, for the reason the payee is: what the approvers approved is what gets acted on.
   * `assertEditable` is the shared guard, so a caller written later inherits it.
   *
   * Each id is resolved BEFORE anything is assigned, and every resolution is company-scoped
   * (invariant 1) — a cross-company warehouse, employee or vendor must never be persisted, even
   * briefly, and a correction must not be able to reach further than the creation it corrects. This
   * is stricter than `createDraft`, which stores these as given and leaves everything to submit;
   * deliberately so, since the whole purpose here is to unstick a draft and storing an unusable id
   * would only move the dead end.
   *
   * Writes no `budget_txn` and no `quota_usage` row and takes no lock: it is refused outside DRAFT,
   * which is before submit reserves anything, so no reservation exists for a corrected document and
   * there is nothing for a concurrent writer to race. One flush, so a vendor and a payee that
   * disagree are never observable.
   */
  async setSelections(documentId: string, dto: SetSelectionsDto): Promise<void> {
    const em = this.scope.forActiveCompany();
    const document = await this.getWith(em, documentId);
    this.assertEditable(document);

    // Absent key = leave alone; explicit null = clear. `@IsOptional()` lets both through, so the
    // two are told apart by presence and not by truthiness — a type that loses requires_warehouse
    // must be able to have the warehouse taken back off, which is not "unmentioned".
    const given = <K extends keyof SetSelectionsDto>(key: K): boolean =>
      Object.prototype.hasOwnProperty.call(dto, key) && dto[key] !== undefined;

    // Resolve everything first. Nothing below assigns until every supplied id has passed, so a
    // request carrying one good value and one bad one leaves the document exactly as it was.
    let warehouse: Warehouse | null | undefined;
    if (given('warehouseId')) {
      warehouse = dto.warehouseId ? await this.requireWarehouses().requireActive(dto.warehouseId) : null;
    }
    let destWarehouse: Warehouse | null | undefined;
    if (given('destWarehouseId')) {
      destWarehouse = dto.destWarehouseId
        ? await this.requireWarehouses().requireActive(dto.destWarehouseId)
        : null;
    }
    let relatedEmployee: Employee | null | undefined;
    if (given('relatedEmployeeId')) {
      relatedEmployee = dto.relatedEmployeeId
        ? await this.requireEmployeeOfThisCompany(em, document, dto.relatedEmployeeId)
        : null;
    }
    let vendor: Vendor | null | undefined;
    if (given('vendorId')) {
      if (dto.vendorId) {
        // The same enablement guard submit applies, and the one the wizard's picker is filled from.
        await this.requireVendors().assertVendorEnabled(dto.vendorId);
        vendor = await em.findOneOrFail(Vendor, { id: dto.vendorId });
      } else {
        vendor = null;
      }
    }

    // Stock cannot move to where it already is. Checked against the RESULTING pair rather than the
    // supplied one, so setting only one end against an existing other end is caught too.
    const sourceId = (warehouse === undefined ? document.warehouse?.id : warehouse?.id) ?? undefined;
    const destId =
      (destWarehouse === undefined ? document.destWarehouse?.id : destWarehouse?.id) ?? undefined;
    if (sourceId && destId && sourceId === destId) {
      throw new BadRequestException('The source and destination warehouses must be different');
    }

    if (warehouse !== undefined) document.warehouse = warehouse ?? undefined;
    if (destWarehouse !== undefined) document.destWarehouse = destWarehouse ?? undefined;
    if (relatedEmployee !== undefined) document.relatedEmployee = relatedEmployee ?? undefined;
    if (vendor !== undefined) {
      document.vendor = vendor ?? undefined;
      // The payee must belong to the document's own vendor at submit. Rather than refusing the
      // vendor change while a payee is set — which would impose an order of work the screen does
      // not explain — drop a payee the new vendor does not own. It flushes with the vendor, so the
      // two are never observable disagreeing.
      const payeeVendorId = document.vendorBankAccount
        ? (await em.findOneOrFail(
            VendorBankAccount,
            { id: document.vendorBankAccount.id },
            { populate: ['vendor'], ...FILTER_OFF },
          )).vendor.id
        : undefined;
      if (payeeVendorId && payeeVendorId !== vendor?.id) document.vendorBankAccount = undefined;
    }

    await em.flush();
  }

  /** The employee a document names must be one of its own company's (invariant 1). */
  private async requireEmployeeOfThisCompany(
    em: EntityManager,
    document: Document,
    employeeId: string,
  ): Promise<Employee> {
    const employee = await em.findOne(
      Employee,
      { id: employeeId, company: document.company.id },
      FILTER_OFF,
    );
    if (!employee) throw new BadRequestException('That employee does not belong to this company');
    return employee;
  }

  private requireWarehouses(): WarehouseService {
    if (!this.warehouses) throw new Error('WarehouseService is not wired into DocumentService');
    return this.warehouses;
  }

  private requireVendors(): VendorService {
    if (!this.vendors) throw new Error('VendorService is not wired into DocumentService');
    return this.vendors;
  }

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

  /**
   * What this reader may see, as a `where` fragment: their granted `DOC_VIEW` scope, WIDENED by the
   * documents they are party to.
   *
   * The scope half is what `rbac`'s Data Scope Enforcement has always required and nothing ever
   * applied — `ScopeService.scopeWhere` existed, was unit-tested, and was called by no service, so
   * every reader saw the whole company.
   *
   * The party half exists because approving IS work on other departments' documents. A department
   * head at DEPARTMENT scope who could not open the disbursement they are being asked to sign would
   * force the administrator to grant every approver COMPANY, which is the visibility this narrowing
   * removes. `approval_log` covers "I acted on it" and is append-only, so it stays findable forever;
   * the recorded step actors cover "it is in my queue" before any action exists.
   *
   * COMPANY and GROUP short-circuit: `scopeWhere` returns `{}` for them, and a union with the whole
   * company is the whole company. The largest result sets therefore pay nothing for the party query.
   *
   * Company isolation is NOT part of this fragment — it is already applied by the em this runs on
   * (invariant 1), so a party id from another company simply matches no row.
   */
  private async visibleWhere(em: EntityManager): Promise<FilterQuery<Document>> {
    const scoped = this.scopes.scopeWhere(P.DOC_VIEW, {
      ownerField: 'createdBy',
      deptField: 'department',
    }) as Record<string, unknown>;
    if (Object.keys(scoped).length === 0) return {};

    // A narrowing scope resolved to no value — no user on the context for OWN, no department for
    // DEPARTMENT — must match nothing, not everything and not a malformed uuid. `scopeWhere` is
    // fail-safe by design (an ungranted code collapses to OWN), and that safety is only real if the
    // collapsed predicate is a refusal rather than a crash: `{ createdBy: '' }` reaches Postgres as
    // `invalid input syntax for type uuid` and turns a read the caller may not make into a 500.
    if (Object.values(scoped).some((v) => v === undefined || v === null || v === '')) {
      return MATCHES_NOTHING;
    }

    const partyIds = await this.partyDocumentIds(em);
    return partyIds.length ? { $or: [scoped, { id: { $in: partyIds } }] } : scoped;
  }

  /** Ids of documents this user has acted on, or that have opened a step naming them. */
  private async partyDocumentIds(em: EntityManager): Promise<string[]> {
    const userId = RequestContext.userId();
    if (!userId) return [];
    const ids = new Set<string>();

    // 1. Acted on it. Append-only, so this never expires.
    const acted = await em.find(ApprovalLog, { approver: userId }, { ...FILTER_OFF, fields: ['document'] });
    for (const a of acted) ids.add(a.document.id);

    // 2. Named as a principal on a live step — it is in my queue, before I have acted.
    const assigned = await em.find(
      DocumentApprovalStepActor,
      { user: userId, step: { supersededAt: null } },
      { ...FILTER_OFF, populate: ['step'] },
    );
    for (const a of assigned) ids.add(a.step.document.id);

    // 3. Escalated to me. `escalatedToUser` is deliberately NOT a `DocumentApprovalStepActor` —
    //    that set is what a PARALLEL_ALL step must cover, and an escalation must never add a
    //    required approval — so it has to be read separately or the person the SLA just handed the
    //    work to cannot open it.
    const escalated = await em.find(
      DocumentApprovalStep,
      { escalatedToUser: userId, supersededAt: null },
      { ...FILTER_OFF, fields: ['document'] },
    );
    for (const s of escalated) ids.add(s.document.id);

    // 4. Delegated to me while someone is away. Delegation is resolved live by
    //    `ApproverResolverService.eligible` and stored nowhere, so it too has to be recomputed here.
    //
    //    Narrowed to exactly what the delegation covers — its type and its amount ceiling. Being
    //    able to SEE is not authority, but a delegation for one document type is not a licence to
    //    read the delegator's other work, and a read filter that is wider than the authority it
    //    mirrors is a second, quieter permission rule.
    for (const id of await this.delegatedDocumentIds(em, userId)) ids.add(id);

    // The ids become an `IN (...)`. Fine at this size — the largest holder on the live data is party
    // to ten documents. If that ever reaches the high hundreds, turn this into an EXISTS subquery
    // over the same four sources with the QueryBuilder rather than growing the literal.
    return [...ids];
  }

  /** Documents on a live step whose principal has an active, applicable delegation to this user. */
  private async delegatedDocumentIds(em: EntityManager, userId: string): Promise<string[]> {
    const companyId = RequestContext.companyId();
    if (!companyId) return [];
    const today = new Date().toISOString().slice(0, 10);
    const delegations = await em.find(
      ApprovalDelegation,
      {
        delegate: userId,
        company: companyId,
        status: 'ACTIVE',
        startDate: { $lte: today },
        endDate: { $gte: today },
      },
      { ...FILTER_OFF, populate: ['documentType'] },
    );
    if (!delegations.length) return [];

    const principalIds = [...new Set(delegations.map((d) => d.delegator.id))];
    const theirSteps = await em.find(
      DocumentApprovalStepActor,
      { user: { $in: principalIds }, step: { supersededAt: null } },
      { ...FILTER_OFF, populate: ['step.document'] },
    );

    const out: string[] = [];
    for (const row of theirSteps) {
      const doc = row.step.document;
      const covers = delegations.some(
        (d) =>
          d.delegator.id === row.user.id &&
          (!d.documentType || d.documentType.id === doc.documentType?.id) &&
          (d.amountLimit == null || Money.compare(doc.baseTotalAmount ?? '0', d.amountLimit) <= 0),
      );
      if (covers) out.push(doc.id);
    }
    return out;
  }

  async list(q: DocumentListQueryDto = {}): Promise<Paginated<Document>> {
    // forActiveCompany() returns a forked em with the company filter applied, so the
    // scope stays in the (auto-applied) where; the built filter only narrows within it
    // and paging adds the window. A cross-company filter value simply matches no rows.
    const em = this.scope.forActiveCompany();
    // Visibility first, the caller's own filter second, conjunctively — a filter narrows what the
    // reader may see and can never widen it.
    const where = { $and: [await this.visibleWhere(em), buildDocumentFilter(q)] } as FilterQuery<Document>;
    return paginate(em, Document, where, { orderBy: { createdAt: 'DESC' } }, q);
  }

  /**
   * Refuse, as not-found, a document this reader may not see.
   *
   * For the reads that return a document's CONTENT without going through `get`/`detail` — the PDF,
   * the attachment list and its download links, the 3-way match. Each is gated on `DOC_VIEW` and
   * each resolved the document by id within the company alone, so narrowing the list without
   * narrowing them would have hidden a document from the screen while still serving its PDF and its
   * files to anyone holding the id — and an id is in every link anyone was ever sent.
   *
   * A count, not a fetch: the callers load what they need themselves, and this only has to answer
   * whether they are allowed to.
   */
  async assertVisible(id: string): Promise<void> {
    if (!(await this.isVisible(id))) throw new NotFoundException(`Document ${id} not found`);
  }

  /**
   * The same question as `assertVisible`, answered rather than thrown.
   *
   * The chain export asks it about a document's predecessors, where an unreadable one is not an
   * error: it is a document that is simply not part of the set this caller may print, and the rest
   * of the set still prints.
   */
  async isVisible(id: string): Promise<boolean> {
    const em = this.scope.forActiveCompany();
    const where = { $and: [{ id }, await this.visibleWhere(em)] } as FilterQuery<Document>;
    return (await em.count(Document, where)) > 0;
  }

  async get(id: string): Promise<Document> {
    // The read endpoint answers exactly what the list would show. Resolving by id must not be a way
    // around the list, or the list is only a suggestion and every id anyone was ever sent is a key.
    const em = this.scope.forActiveCompany();
    const where = { $and: [{ id }, await this.visibleWhere(em)] } as FilterQuery<Document>;
    const document = await em.findOne(Document, where);
    if (!document) throw new NotFoundException(`Document ${id} not found`);
    return document;
  }

  /**
   * Full detail read for a single document, scoped to the active company: the document
   * header plus its field values, line items, attachment metadata, and predecessor
   * reference (doc_no + status) so the client can render the whole document.
   */
  async detail(id: string): Promise<{
    document: Record<string, unknown>;
    requesterName: string | null;
    fieldValues: Array<{ formFieldId: string; fieldName: string; fieldLabel: string; fieldType: string; value?: string }>;
    lines: DocumentLine[];
    attachments: DocumentAttachment[];
    refDocument: { id: string; docNo: string; status: DocStatus } | null;
    /**
     * Whether a payment was recorded against this document, i.e. whether there is payment
     * evidence to read. The client used to find this out by asking for the slips and treating
     * the 404 as the answer, which made a real failure of that read — a 500, a dropped
     * connection — indistinguishable from a document that was simply never paid.
     */
    hasPayment: boolean;
    /**
     * Whether the step this document is CURRENTLY waiting on refuses to be approved without a
     * transfer slip, and whether one is attached. Read from the recorded route, like every other
     * fact about the step the document is on.
     *
     * Both are sent even when false, so the approval surface can state the requirement and its
     * state rather than discovering it by submitting an approval and reading the refusal. The
     * server still enforces; this is what lets the client explain instead of merely failing.
     */
    slipRequired: boolean;
    hasSlip: boolean;
  }> {
    const em = this.scope.forActiveCompany();
    const document = await em.findOne(
      Document,
      // The same predicate the list uses: everything the list shows can be opened, and nothing it
      // hides can be read by knowing an id.
      { $and: [{ id }, await this.visibleWhere(em)] } as FilterQuery<Document>,
      // vendorBankAccount is populated so an approver can see where the money lands before
      // approving, rather than trusting the destination implicitly. createdBy is populated
      // because the client gates "cancel your own document" and the self-approval mirror on
      // who created it, and an unpopulated relation serializes as a bare id string — which
      // every one of those checks reads as `.id` and silently resolves to undefined.
      { populate: ['refDocument', 'documentType', 'vendor', 'vendorBankAccount', 'currency', 'createdBy'] },
    );
    if (!document) throw new NotFoundException(`Document ${id} not found`);
    // Requester (createdBy) name for the approver to see who submitted. Prefer the creator's
    // employee full name in this company, else the account username (mirrors the PDF proposer
    // resolution). Fetched as partials (a single name field) rather than populating the
    // relation onto `document`, which would serialize the whole AppUser — including
    // passwordHash — into the detail response.
    const requesterEmp = await em.findOne(
      Employee,
      { user: document.createdBy.id, company: document.company.id },
      { fields: ['fullName'], ...FILTER_OFF },
    );
    const requesterUser = requesterEmp
      ? null
      : await em.findOne(AppUser, { id: document.createdBy.id }, { fields: ['username'], ...FILTER_OFF });
    const requesterName = requesterEmp?.fullName ?? requesterUser?.username ?? null;
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
    // A count, not the payment: the detail response says only whether there is evidence to
    // read. Reading it stays PAYMENT_VIEW's business, on the slips route.
    const hasPayment = (await em.count(Payment, { document: id })) > 0;
    const hasSlip = (await em.count(PaymentAttachment, { document: id })) > 0;
    // The live step only — a requirement on a step already passed, or not yet reached, is not this
    // approver's business. `supersededAt: null` keeps a resubmitted document on its current route.
    const currentStep = await em.findOne(DocumentApprovalStep, {
      document: id,
      stepNo: document.currentStepNo,
      supersededAt: null,
    });
    const slipRequired = currentStep?.requiresPaymentSlip ?? false;
    return {
      // createdBy is narrowed to id + username, the shape the rest of the API already returns
      // a user in (payment handoffs, pending vouchers, period actions). Serializing the whole
      // AppUser would hand every DOC_VIEW holder the creator's email and verification state
      // for nothing — the client only needs to compare the id and print the name.
      document: {
        ...wrap(document).toJSON(),
        createdBy: { id: document.createdBy.id, username: document.createdBy.username },
      },
      requesterName,
      fieldValues,
      lines,
      attachments,
      refDocument: document.refDocument
        ? { id: document.refDocument.id, docNo: document.refDocument.docNo, status: document.refDocument.status }
        : null,
      hasPayment,
      slipRequired,
      hasSlip,
    };
  }

  /**
   * Document types occurring in the list this caller can see — the option list for the
   * documents-list type filter.
   *
   * Deliberately not `listCreatableTypes`. That answers "which types may I author", which is a
   * different question with a different answer: a reviewer who creates nothing would get an empty
   * filter over a populated list, which is what shipped. This walks the same scoped query the
   * list endpoint walks, so it can disclose nothing the caller could not learn by paging.
   *
   * Inactive types are kept. A type deactivated last year still sits on last year's documents,
   * and dropping it would leave those rows unfilterable.
   */
  async listTypesInView(): Promise<Array<{ id: string; code: string; name: string }>> {
    // Same entry point as `list()`, so the scope predicate matches by construction rather than
    // by being copied. `fields` keeps this to the FK column instead of hydrating every document.
    const em = this.scope.forActiveCompany();
    const docs = await em.find(Document, {}, { fields: ['documentType'] });
    const typeIds = [...new Set(docs.map((d) => d.documentType.id))];
    if (!typeIds.length) return [];
    // Hydrate by id rather than through the relation: the shared EM can hold DocumentType as an
    // unloaded reference, whose code/name would then read as undefined (see listCreatableTypes).
    const types = await em.find(DocumentType, { id: { $in: typeIds } }, FILTER_OFF);
    return types
      .map((t) => ({ id: t.id, code: t.code, name: t.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Document types the active department may create (for a DOC_CREATE requester). */
  async listCreatableTypes(): Promise<
    Array<{ id: string; code: string; name: string; category: string; requiresBudget: boolean; requiresQuota: boolean; requiresVendor: boolean; requiresItem: boolean; requiresPayee: boolean; requiresWarehouse: boolean; requiresEmployee: boolean; accruesOnApproval: boolean; defaultGlAccount?: string; postAction?: string; authoringRoute?: string }>
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
      // The form asks for the supplier's tax invoice on these, because they are the documents
      // whose accrual claims the input VAT and is dated by it.
      // The wizard branches on all four: the warehouse and employee selectors it could not render
      // without them, the destination warehouse a TRANSFER_STOCK needs, and whether choosing this
      // card should leave the wizard for the screen that authors the type.
      requiresWarehouse: t.requiresWarehouse,
      requiresEmployee: t.requiresEmployee,
      accruesOnApproval: t.accruesOnApproval,
      defaultGlAccount: t.defaultGlAccount,
      postAction: t.postAction,
      authoringRoute: t.authoringRoute,
    }));
  }

  /**
   * The form fields of a creatable type's mapped template, for rendering — plus the type flags the
   * wizard branches on, so a wizard opened straight into one type needs no second call to the list.
   */
  async formForType(documentTypeId: string): Promise<{
    documentTypeId: string;
    formTemplateId: string;
    version: number;
    requiresWarehouse: boolean;
    requiresEmployee: boolean;
    postAction?: string;
    authoringRoute?: string;
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
    const docType = await this.em.findOne(DocumentType, { id: documentTypeId }, FILTER_OFF);
    return {
      documentTypeId,
      formTemplateId: template.id,
      version: template.version,
      requiresWarehouse: docType?.requiresWarehouse ?? false,
      requiresEmployee: docType?.requiresEmployee ?? false,
      postAction: docType?.postAction,
      authoringRoute: docType?.authoringRoute,
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

  /**
   * A field that offers a fixed set of values SHALL only be given one of them.
   *
   * Until this existed a dropdown was decoration: the form read advertised the choices and the
   * write stored whatever string arrived, so a caller could put anything at all in a field the
   * form said was a choice — including a value the system knows it cannot honour. `settlementKind`
   * made that concrete. `GOODS` was on offer, the document approved and raised a payable, and
   * settlement then refused it, leaving a liability with no way to clear it. The value was
   * rejected three steps too late.
   *
   * Deliberately generic. No document type is named here: the options on the field are the rule,
   * exactly as `document_type` flags and `workflow` bands are the rule elsewhere. A type that
   * later offers a different set inherits this without a line of code.
   *
   * A field whose stored options cannot be parsed is not enforced — the same choice the form read
   * makes. Refusing every write because one config row is malformed would turn a bad option list
   * into an outage.
   */
  /**
   * A value must be one the field offers, and must not carry markup unless the field is a rich-text
   * one. The second half is the write boundary for the field-type contract: `text` renders a rich
   * editor, so a salary configured as `text` was stored as `<p>7500000</p>` — a value the promotion
   * post-action's decimal guard can never accept, discovered at approval by somebody who did not
   * fill the form in. Refusing it here names the field instead.
   */
  private async assertValuesAreOffered(em: EntityManager, values: FieldValueInput[]): Promise<void> {
    const ids = [...new Set(values.map((v) => v.formFieldId))];
    if (ids.length === 0) return;
    const fields = await em.find(FormField, { id: { $in: ids } }, FILTER_OFF);
    const byId = new Map(fields.map((f) => [f.id, f]));

    for (const v of values) {
      // An absent or empty value clears the field. Whether it was allowed to be empty is the
      // required-field check at submit, not this one — this only says that a value, when given,
      // has to be one of the offered ones.
      if (v.value === undefined || v.value === '') continue;
      const field = byId.get(v.formFieldId);
      if (field && !isHtmlFieldType(field.fieldType) && carriesMarkup(v.value)) {
        throw coded(
          ErrorCode.VALIDATION_FAILED,
          `${field.fieldName} is a ${field.fieldType} field and cannot store markup`,
        );
      }
      const offered = field?.optionsJson ? parseOptions(field.optionsJson) : undefined;
      if (!offered || offered.includes(v.value)) continue;
      throw coded(
        ErrorCode.VALIDATION_FAILED,
        `'${v.value}' is not a value ${field!.fieldName} accepts — choose one of: ${offered.join(', ')}`,
      );
    }
  }

  private async writeFieldValues(
    em: EntityManager,
    document: Document,
    values: FieldValueInput[],
  ): Promise<void> {
    await this.assertValuesAreOffered(em, values);
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

  /**
   * The line's GL account and its budget, resolved INDEPENDENTLY — see {@link writeLines}.
   *
   * They used to be one lookup: the item gave a GL, the GL gave the budget. That chain assumed a
   * budget and an account are the same thing seen twice, and the customer's books disprove it in
   * both directions at once — one account is charged by fuel, repairs and registration budgets in a
   * single department, and one budget (vehicle instalments) posts to a liability account and an
   * expense account. An account therefore cannot choose between the budgets that share it, and only
   * the requester can.
   *
   * So: the account still comes from the item, server-authoritatively. The budget is the one the
   * requester named. Naming a budget no longer stamps the account — that direction is inverted from
   * what it used to be, and it is the whole point.
   */
  private async resolveLineGlAndBudget(
    em: EntityManager,
    document: Document,
    docType: DocumentType,
    line: DocumentLineInput,
    _docDate: string,
  ): Promise<{ glAccount?: string; budget?: Budget }> {
    const budget = line.budgetId
      ? await this.requireChargeableBudget(em, document, line.budgetId)
      : undefined;

    // The account: from the item when there is one, unchanged.
    if (line.itemId) {
      const itemGl = (await this.items.defaultGlAccountFor(line.itemId)) ?? undefined;
      if (docType.requiresBudget && !itemGl) {
        throw new BadRequestException(
          `Item ${line.itemId} has no default GL account for the active company`,
        );
      }
      return { glAccount: itemGl, budget };
    }

    // Item-less line — the account falls back, in order: the type's default, then the named
    // budget's own account when it records one. This is the only remaining read of
    // `budget.gl_account`, and a budget spanning several accounts records none.
    const glAccount = docType.defaultGlAccount ?? budget?.glAccount ?? undefined;
    return { glAccount, budget };
  }

  /**
   * The budget a line may charge: active, and this company's.
   *
   * Nothing has to be said about categories. They are `budget_node` rows, so there is no id a line
   * could name that would charge one — the check that used to count a budget's children is gone
   * with the shape that made it necessary.
   */
  private async requireChargeableBudget(
    em: EntityManager,
    document: Document,
    budgetId: string,
  ): Promise<Budget> {
    const budget = await em.findOne(
      Budget,
      { id: budgetId, fiscalYear: { company: document.company.id } },
      { ...FILTER_OFF, populate: ['node'] },
    );
    if (!budget) {
      throw new BadRequestException(`Budget ${budgetId} does not exist in this company`);
    }
    if (budget.status !== 'ACTIVE') {
      throw new BadRequestException(`Budget ${budget.node.code} is ${budget.status}, not ACTIVE`);
    }
    return budget;
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

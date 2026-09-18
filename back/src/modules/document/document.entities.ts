import { Check, Entity, Enum, Index, ManyToOne, OptionalProps, Property, Unique } from '@mikro-orm/core';
import {
  DEFAULT_PRINT_TEMPLATE,
  POST_ACTIONS,
  PRINT_TEMPLATES,
  parsePrintTemplates,
  type PostAction,
  type PrintTemplate,
} from '@erp/shared';
import { DocStatus } from '../../common/enums';
import { BaseEntity, CompanyScopedEntity } from '../../common/entities/base.entity';
import { Account } from '../accounting/accounting.entities';
import { Budget } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { Item, Vendor, VendorBankAccount } from '../master-data/master-data.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser, Employee } from '../rbac/rbac.entities';
import { Workflow } from '../approval/approval.entities';
import { TaxCode } from '../tax/tax.entities';
// Type-only: inventory depends on document (it is downstream in the build order), so importing
// the class here would make the two entity modules circular at runtime. `import type` is erased
// at compile time and the decorators name the entity as a string, which MikroORM resolves from
// its metadata registry — the documented way to break an entity cycle.
import type { Warehouse } from '../inventory/inventory.entities';

// document_category — document-type categories as company-scoped config (invariant 1 + config
// over code), replacing the old hardcoded `doc_category` enum. `code` is unique within its
// company and immutable; like DocumentType it is NOT a CompanyScopedEntity — DocumentCategoryService
// scopes it explicitly by `company`.
@Entity({ tableName: 'document_category' })
@Unique({ properties: ['company', 'code'] })
export class DocumentCategory extends BaseEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @Property()
  code!: string;

  @Property()
  name!: string;

  @Property({ default: true })
  isActive: boolean = true;
}

// document_type — owned per company (invariant 1); behavior is config: requires_budget /
// requires_quota / post_action. `code` is unique within its company, not globally. It is NOT a
// CompanyScopedEntity (no auto company filter, which would ripple to every documentType read);
// DocumentTypeService scopes it explicitly by `company`, like budgets do.
@Entity({ tableName: 'document_type' })
@Unique({ properties: ['company', 'code'] })
// Declared on the entity, not only in the migration, for two reasons: the schema generator builds
// the test database from this metadata, so a migration-only constraint is one the tests never
// exercise; and a constraint the ORM does not know about is one its schema diffing would offer to
// drop. Migration20260831000000 writes the same predicate.
@Check({
  name: 'document_type_post_action_check',
  expression: `post_action is null or post_action in (${POST_ACTIONS.map((a) => `'${a}'`).join(', ')})`,
})
// Same reasoning as the post_action check above: declared here so the test database carries it and
// the ORM does not offer to drop it. Not nullable — every document prints as something, and LETTER
// is what "nothing configured" means. A pattern rather than a membership test, because the column
// holds an ordered list: `LETTER`, or `LETTER,PR`, or any other combination of the closed set.
@Check({
  name: 'document_type_print_templates_check',
  expression: `print_templates ~ '^(${PRINT_TEMPLATES.join('|')})(,(${PRINT_TEMPLATES.join('|')}))*$'`,
})
export class DocumentType extends BaseEntity {
  // Carries a database default, so no caller supplies it on create.
  [OptionalProps]?: 'derivesQuantity' | 'printTemplates';

  @ManyToOne(() => Company)
  company!: Company;

  @Property()
  code!: string;

  @Property()
  name!: string;

  // The abbreviation this company stamps in the type position of a paper document number
  // (`1034/ຈຊຈ/ບຫ`). Configuration, not derived from `code` or `name` (invariant 7); a renderer
  // uses it when set and falls back to `code`. Deliberately not unique — two types may stamp alike.
  @Property({ nullable: true })
  shortName?: string;

  // Category is a document_category *code* (a string), validated on write against the active
  // company's document_category rows — same code-reference pattern as `default_gl_account` (a GL
  // code), not a hard FK. Replaces the former `doc_category` enum so categories are config.
  @Property()
  category!: string;

  @Property({ default: false })
  requiresBudget: boolean = false;

  @Property({ default: false })
  requiresQuota: boolean = false;

  // The document must carry a vendor (procurement types like PR/PO); enforced at submit.
  @Property({ default: false })
  requiresVendor: boolean = false;

  // Every line must carry an item (procurement goods for receiving / 3-way matching);
  // enforced at submit like requiresVendor.
  @Property({ default: false })
  requiresItem: boolean = false;

  // The document must name a payee bank account before it can be submitted; enforced at submit
  // like requiresVendor.
  //
  // Deliberately its own flag rather than a reading of post_action (invariant 7): the seeded PR
  // also carries CUT_BUDGET — so it can settle its own reservation — but nobody knows the payee
  // account when raising a requisition, so keying the payee off CUT_BUDGET would block every PR
  // submit. post_action answers "what does full approval do to the budget"; this answers "does
  // this document name a destination for money". They are different questions.
  @Property({ default: false })
  requiresPayee: boolean = false;

  // The expense is recognised when the document is fully approved, not when a payment settles: the
  // GL posts a balanced entry debiting the accounts this document's budget cuts name and crediting
  // CLAIM_PAYABLE. For a compensation the obligation arises at approval — the customer is owed
  // whether the transfer happens today or in three weeks — and there may be no payment at all when
  // the money leaves through a bank app rather than a payment batch.
  //
  // Its own flag rather than a reading of post_action or requiresPayee (invariant 7): CUT_BUDGET
  // would catch every PR, and requiresPayee=false would catch every requisition that simply does
  // not know its payee yet. Neither of them was asked about recognition.
  //
  // MAY be combined with requiresPayee, and the seeded DISB is: it is the accepted invoice AND the
  // document that pays it. That pair was rejected once, when both recognitions debited the same
  // expense accounts and the expense landed twice; `postForPayment` clears the payable an accrual
  // raised instead of debiting expense again, which is what made the combination safe and what to
  // check if double recognition is ever suspected.
  //
  // WHICH payable is raised follows from the document, not from this flag: a document with a vendor
  // owes a trade payable, one without owes a claim payable. Both are cleared by the same payment —
  // `accruedPayable` reads the account off the accrual's own credit line — which is why there is
  // one money-out path and not one per kind of payee.
  @Property({ default: false })
  accruesOnApproval: boolean = false;

  // The document must name a warehouse before it can be submitted; enforced at submit like
  // requiresVendor. Independent of requiresItem by design: naming a storage location is a
  // separate question from whether every line names an item.
  @Property({ default: false })
  requiresWarehouse: boolean = false;

  // The document must name a related_employee before it can be submitted — the fifth flag of the
  // same shape as requiresVendor / requiresItem / requiresPayee / requiresWarehouse.
  //
  // Its own flag rather than a reading of post_action (invariant 7): which document names a person
  // is a separate question from what approving it does. Without it the HR post-actions are handed
  // documents with no subject, and their (correct) no-op branch means a promotion routes through
  // every step, is approved, reaches COMPLETED — and changes no employee record.
  @Property({ default: false })
  requiresEmployee: boolean = false;

  // This type is the form a company writes down what ALREADY happened on — a year's spending
  // brought in from outside the system, not a request being raised now. A document of such a type
  // may state the day its money moved, and the budget ledger dates its rows by that day instead of
  // by the clock.
  //
  // On the TYPE rather than on the document on purpose: "is this the form we use to record
  // history?" is a configuration question, and a per-document choice would let any requester turn
  // today's disbursement into last March's. Every type used for daily work leaves this false and is
  // untouched by any of it.
  @Property({ default: false })
  recordsPastEvents: boolean = false;

  /**
   * Where this type's content is authored. `null` = the generic create wizard can write everything
   * this type carries. A value names the client route of the screen that owns it.
   *
   * Some types keep their content outside `document_line` / `doc_field_value`: a budget plan,
   * adjustment and transfer carry `budget_movement`; a voucher carries `journal_voucher`. The
   * generic form produces a well-formed EMPTY document for those — it submits, sits in the approval
   * queue, and is refused by its post-action when an approver finally acts.
   *
   * Deliberately not derived from `post_action`: that answers what full approval does, which is a
   * different question from where the content is written. And deliberately not expressed by
   * removing the `dept_doc_type` mapping — `createDraft` resolves that mapping for EVERY document
   * including the ones a dedicated screen creates, so a type without one cannot be raised at all.
   */
  @Property({ nullable: true })
  authoringRoute?: string;

  /**
   * The quantity this type reserves is computed by the system, not stated by the requester — so
   * the generic submit endpoint refuses it and points the caller at the capability that owns it.
   *
   * Leave is the first such type: its days are counted from the employee's shift and the company
   * holidays, and a client-supplied figure could disagree with both the leave record and the
   * calendar. The rule that computes it lives in a capability built after document-engine, which
   * document-engine cannot import — so this flag lets the generic path DECLINE from configuration
   * rather than depend on code it must not know about.
   */
  @Property({ default: false })
  derivesQuantity: boolean = false;

  // Optional GL code. On a requires_budget type, an item-less line auto-resolves its budget
  // from this GL (+ department + fiscal year), so the requester need not pick a budget.
  @Property({ nullable: true })
  defaultGlAccount?: string;

  // One of POST_ACTIONS, or null for "this type does nothing on approval". Typed as the union
  // rather than a string so PostActionService's switch can end in assertNever — a switch over
  // `string` never narrows to `never`, so the exhaustiveness check would not compile. A CHECK
  // constraint on the column is what makes the database's contents match the type.
  @Property({ nullable: true })
  postAction?: PostAction;

  /**
   * The sheets this type prints, comma-separated in print order (see `PRINT_TEMPLATE_ORDER`).
   *
   * A document can be more than one piece of paper: a purchase request filed as the official
   * letter AND as the purchase-request form is one document type printing two sheets. Stored as
   * text rather than as a child table — the list is at most four entries from a closed set, and
   * the CHECK constraint is what keeps the column's contents matching that set.
   *
   * Read it through `sheets`, never by splitting the string at the call site.
   */
  @Property({ default: DEFAULT_PRINT_TEMPLATE })
  printTemplates: string = DEFAULT_PRINT_TEMPLATE;

  /**
   * The sheets this type prints, parsed and in print order. Never empty.
   *
   * A method rather than a getter: MikroORM derives an entity's required-data shape from its
   * public properties, and a getter there would make every `em.create(DocumentType, …)` demand a
   * value for something that is computed.
   */
  sheets(): PrintTemplate[] {
    return parsePrintTemplates(this.printTemplates);
  }

  @Property({ default: true })
  isActive: boolean = true;
}

// form_template — old documents stay pinned to their form version.
@Entity({ tableName: 'form_template' })
@Unique({ properties: ['documentType', 'version'] })
export class FormTemplate extends BaseEntity {
  @ManyToOne(() => DocumentType)
  documentType!: DocumentType;

  @Property({ type: 'int', default: 1 })
  version: number = 1;

  @Property({ default: 'DRAFT' })
  status: string = 'DRAFT';

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date;
}

@Entity({ tableName: 'form_field' })
export class FormField extends BaseEntity {
  @ManyToOne(() => FormTemplate)
  formTemplate!: FormTemplate;

  @Property()
  fieldName!: string;

  @Property()
  fieldLabel!: string;

  // text / number / date / dropdown / file / line_items
  @Property()
  fieldType!: string;

  @Property({ default: false })
  isRequired: boolean = false;

  @Property({ type: 'int', default: 0 })
  sortOrder: number = 0;

  @Property({ type: 'text', nullable: true })
  optionsJson?: string;

  @Property({ type: 'text', nullable: true })
  conditionJson?: string;
}

// document_type_ref — allowed predecessor→successor pairings for the reference chain
// (PR→PO, PROC→PO, PO→DISB, ADVANCE→CLEAR_ADVANCE). Configurable per company: replaces the
// old hardcoded REF_CHAIN object (invariant 7). Like document_type it is NOT a
// CompanyScopedEntity — it is scoped explicitly by `company` in ref-chain.config.ts, and both
// pairing endpoints must be document_types of that same company (invariant 1).
@Entity({ tableName: 'document_type_ref' })
// Name pinned to what is actually in the database: Migration20260716000000 asked for
// `..._successor_type_id_unique` (73 chars) and PostgreSQL silently truncated it to 63. Without
// this, MikroORM derives its own hashed name and every schema diff wants to rename the constraint.
@Unique({
  name: 'document_type_ref_company_id_predecessor_type_id_successor_type',
  properties: ['company', 'predecessorType', 'successorType'],
})
// Created by Migration20260716000000: resolves a predecessor's pairings within one company.
@Index({ properties: ['company', 'predecessorType'] })
export class DocumentTypeRef extends BaseEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @ManyToOne(() => DocumentType, { fieldName: 'predecessor_type_id' })
  predecessorType!: DocumentType;

  @ManyToOne(() => DocumentType, { fieldName: 'successor_type_id' })
  successorType!: DocumentType;

  // When true, the CREATE_SUCCESSOR post-action auto-creates a DRAFT of successorType on full
  // approval of a predecessorType document. false = the pairing is available for manual create-from
  // only. A predecessor may have several auto_create successors (all are created).
  @Property({ default: false })
  autoCreate: boolean = false;

  // The department an auto-created successor is created in — which also pins its form template and
  // workflow, via the dept_doc_type mapping. Null = the source document's own department (right for
  // same-department chains like ADVANCE→CLEAR_ADVANCE). Set = a cross-department handoff: PROC→PO
  // lands the PO in Procurement whichever department raised the requisition, because in
  // procurement the requesting department asks and the buying department buys. Must belong to the
  // pairing's company. Only auto_create reads this; a manual create-from takes the department of
  // the user doing the creating.
  @ManyToOne(() => Department, { fieldName: 'successor_department_id', nullable: true })
  successorDepartment?: Department;
}

// dept_doc_type — which dept uses which doc type, form, and workflow.
@Entity({ tableName: 'dept_doc_type' })
@Unique({ properties: ['department', 'documentType'] })
export class DeptDocType extends BaseEntity {
  @ManyToOne(() => Department)
  department!: Department;

  @ManyToOne(() => DocumentType)
  documentType!: DocumentType;

  @ManyToOne(() => FormTemplate)
  formTemplate!: FormTemplate;

  @ManyToOne(() => Workflow)
  workflow!: Workflow;

  @Property({ default: true })
  isActive: boolean = true;
}

// document — runtime document. FX rate is locked here at submit (invariant 6).
@Entity({ tableName: 'document' })
@Unique({ properties: ['company', 'docNo'] })
@Index({ properties: ['company', 'department', 'status'] })
// Declared as an expression rather than @Unique({ properties }) because it must be PARTIAL: every
// document raised in the web app has a null source_id, and a plain unique index would allow only
// one of them per company. Declared HERE rather than only in the migration because specs build
// their schema from these entities — an index that lives only in a migration is an index no test
// can ever exercise, and this one is what stops a retry from reserving the budget twice.
@Index({
  name: 'document_company_source_unique',
  expression:
    'create unique index "document_company_source_unique" on "document" ' +
    '("company_id", "source_type", "source_id") where "source_id" is not null',
})
export class Document extends CompanyScopedEntity {
  @Property()
  docNo!: string;

  @ManyToOne(() => Company)
  company!: Company;

  @ManyToOne(() => Department)
  department!: Department;

  @ManyToOne(() => DocumentType)
  documentType!: DocumentType;

  @ManyToOne(() => FormTemplate)
  formTemplate!: FormTemplate;

  @ManyToOne(() => Workflow)
  workflow!: Workflow;

  @Property({ type: 'int', default: 0 })
  currentStepNo: number = 0;

  @Index()
  @ManyToOne(() => AppUser, { fieldName: 'created_by' })
  createdBy!: AppUser;

  @ManyToOne(() => Document, { fieldName: 'ref_document_id', nullable: true })
  refDocument?: Document;

  @ManyToOne(() => Employee, { nullable: true })
  relatedEmployee?: Employee;

  @ManyToOne(() => Vendor, { nullable: true })
  vendor?: Vendor;

  /**
   * Where the money lands. Required at submit when the type's `requiresPayee` is set; must be an
   * active account of this document's own vendor.
   *
   * Chosen on the document rather than at payment time so the destination travels the same 6–7
   * approval steps as the amount: the approvers who approve the spend also approve the payee, and
   * no later actor can redirect an approved payment. Immutable once the document leaves DRAFT.
   */
  @ManyToOne(() => VendorBankAccount, { fieldName: 'vendor_bank_account_id', nullable: true })
  vendorBankAccount?: VendorBankAccount;

  /**
   * Where stock moves from. Required at submit when the type's `requiresWarehouse` is set, and
   * validated to an active warehouse of this document's own company — stock never crosses a
   * company boundary (invariant 1).
   */
  @ManyToOne('Warehouse', { fieldName: 'warehouse_id', nullable: true })
  warehouse?: Warehouse;

  /** Where stock moves to. Required only for a TRANSFER_STOCK type; must be the same company. */
  @ManyToOne('Warehouse', { fieldName: 'dest_warehouse_id', nullable: true })
  destWarehouse?: Warehouse;

  @ManyToOne(() => Currency, { fieldName: 'currency', nullable: true })
  currency?: Currency;

  // Locked at submit, never recomputed.
  @Property({ type: 'decimal', precision: 18, scale: 8, default: 1 })
  exchangeRate: string = '1';

  @Property({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  totalAmount?: string;

  // Converted to company base currency at the DAILY rate — display + payment FX basis.
  @Property({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  baseTotalAmount?: string;

  // Budget basis: converted at the BUDGET_RATE (daily fallback). Drives budget control and
  // approval-threshold comparison, so daily FX swings don't whipsaw the budget.
  @Property({ type: 'decimal', precision: 18, scale: 8, nullable: true })
  budgetExchangeRate?: string;

  @Property({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  budgetBaseTotalAmount?: string;

  // Purchase-tax totals (document currency), stamped at submit. base_tax_total is tax_total at
  // the locked daily rate — the input-VAT figure the GL posts.
  @Property({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  subTotal?: string;

  @Property({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  taxTotal?: string;

  /**
   * The SUPPLIER's tax invoice, not this system's `docNo`.
   *
   * The tax point for input VAT is the invoice, and it is the supplier's number and date that a
   * revenue authority matches a claim against. Nullable because most document types are not
   * purchases; required at submit only when the document actually claims VAT.
   */
  @Property({ nullable: true })
  vendorInvoiceNo?: string;

  @Property({ columnType: 'date', nullable: true })
  vendorInvoiceDate?: string;

  /**
   * The day this document's money actually moved, stated by the person recording it.
   *
   * Set only on a type whose `recordsPastEvents` is true, and only by someone holding
   * `DOC_BACKDATE`. Every `budget_txn` row the document writes carries this as `txn_date` — the
   * RESERVE at submit and the ACTUAL/RELEASE at settlement alike — so a spend from March is
   * reportable as March.
   *
   * Null for every ordinary document, where the ledger dates its rows by the company's day at the
   * moment of the write, as it always has.
   *
   * NOT a substitute for `submitted_at` or `approved_at`. Those say when the system was told and
   * when a person signed; this says when the money left. A backdated document is still submitted
   * and approved at the real clock time.
   */
  @Property({ columnType: 'date', nullable: true })
  moneyMovedOn?: string;

  @Property({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  grandTotal?: string;

  @Property({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  baseTaxTotal?: string;

  @Enum({ items: () => DocStatus, default: DocStatus.DRAFT })
  status: DocStatus = DocStatus.DRAFT;

  @Property({ columnType: 'timestamptz', nullable: true })
  submittedAt?: Date;

  // Snapshot of the proposer's signature at SUBMIT — the `app_user.current_signature_id` of the
  // person who submitted, stamped once and never recomputed (invariant 6, like `exchangeRate`).
  // Null for an API-key submit (a system, not a person) and for documents submitted before this
  // column existed. Held as a scalar FK (not a relation) for the same reason as
  // `AppUser.currentSignatureId`: it keeps this file free of a class reference into rbac and the
  // entity graph acyclic; the database carries the real FK via migration.
  @Property({ fieldName: 'submitted_signature_id', type: 'uuid', nullable: true })
  submittedSignatureId?: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  approvedAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date;

  /**
   * Where this document came from, when it came from outside.
   *
   * `sourceType` names the feed, `sourceId` is that system's own identifier for the thing. Both
   * are opaque here: nothing derives them from the API key or infers them when absent, and a
   * caller supplies both or neither. Together with the company they are a unique key, so a caller
   * that retries after a timeout gets the document it already created rather than a second one —
   * which would submit a second budget reservation against an append-only ledger. `journal_entry`
   * carries the same pair for the same reason.
   */
  @Property({ nullable: true })
  sourceType?: string;

  @Property({ nullable: true })
  sourceId?: string;
}

@Entity({ tableName: 'doc_field_value' })
@Unique({ properties: ['document', 'formField'] })
export class DocFieldValue extends BaseEntity {
  @ManyToOne(() => Document)
  document!: Document;

  @ManyToOne(() => FormField)
  formField!: FormField;

  @Property({ type: 'text', nullable: true })
  fieldValue?: string;
}

// document_line — multi-line PR/PO; each line can cut a different budget.
@Entity({ tableName: 'document_line' })
@Unique({ properties: ['document', 'lineNo'] })
export class DocumentLine extends BaseEntity {
  @ManyToOne(() => Document)
  document!: Document;

  @Property({ type: 'int' })
  lineNo!: number;

  @ManyToOne(() => Item, { nullable: true })
  item?: Item;

  @Property()
  description!: string;

  @Property({ type: 'decimal', precision: 15, scale: 4, default: 1 })
  qty: string = '1';

  @Property({ nullable: true })
  unit?: string;

  @Property({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  unitPrice: string = '0';

  @Property({ type: 'decimal', precision: 15, scale: 2 })
  lineAmount!: string;

  // VAT tax code for the line (null = untaxed) and the computed tax at submit (doc currency).
  @ManyToOne(() => TaxCode, { nullable: true })
  taxCode?: TaxCode;

  // Stamped at submit; the DB default covers draft lines created before submit.
  @Property({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  taxAmount?: string;

  @Property({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  baseLineAmount?: string;

  // Budget basis at the BUDGET_RATE (daily fallback) — the amount reserved + settled.
  @Property({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  budgetBaseLineAmount?: string;

  @Index()
  @ManyToOne(() => Budget, { nullable: true })
  budget?: Budget;

  /**
   * The account code this line displays. A display value: resolved when the draft is written, free
   * to be empty, and NOT what the ledger reads — {@link account} is.
   */
  @Property({ nullable: true })
  glAccount?: string;

  /**
   * The expense account this line's spending posts to, resolved once at submit.
   *
   * Stamped as a foreign key, never re-derived. The posting used to read `budget.account_id`, which
   * meant an account configured where the product asks for it — on the item, on the document type —
   * never reached the ledger, and one budget could debit exactly one account. It reads this now.
   *
   * An FK rather than the `gl_account` code beside it, and fixed at submit rather than resolved at
   * payment, because re-deriving mutable configuration late is how an item whose default GL is
   * edited after approval would clear a different account than the budget was cut on — silently,
   * with the entry still balancing.
   *
   * Nullable, permanently. Every document submitted before this column existed carries none,
   * `spend-import` writes lines directly, and a chain settled through an ancestor reads that
   * ancestor's lines. A null means "post the old way": fall back to the budget's own account.
   */
  @Index()
  @ManyToOne(() => Account, { fieldName: 'account_id', nullable: true })
  account?: Account;

  // Accumulated received qty for 3-way matching.
  @Property({ type: 'decimal', precision: 15, scale: 4, default: 0 })
  receivedQty: string = '0';

  /**
   * When this line was last received against.
   *
   * `receivedQty` is a running total with no time attached, so it cannot answer "how much had been
   * received as at the 30th" — which is exactly the question a period-close accrual asks. Stock
   * lines have `stock_txn.created_at`; untracked lines had nothing at all until this.
   *
   * Null means received before this column existed, so the date is unknown.
   */
  @Property({ columnType: 'timestamptz', nullable: true })
  lastReceivedAt?: Date;

  @Property({ default: 'OPEN' })
  lineStatus: string = 'OPEN';
}

// document_attachment — file lives in S3/MinIO; only the path is stored.
@Entity({ tableName: 'document_attachment' })
export class DocumentAttachment extends BaseEntity {
  @Index()
  @ManyToOne(() => Document)
  document!: Document;

  // Server-generated for new rows: `<doc_no>-<nn><ext>` — what the list shows, the download is
  // called and the PDF evidence page prints. Older rows keep the name they were filed under.
  @Property()
  fileName!: string;

  // What the uploader called the file, decoded as UTF-8. Informational only — never a storage key,
  // never a caption. Null for rows recorded before names were generated.
  @Property({ fieldName: 'original_file_name', nullable: true })
  originalFileName?: string;

  @Property()
  filePath!: string;

  @Property({ type: 'int', nullable: true })
  fileSizeKb?: number;

  @Property({ nullable: true })
  mimeType?: string;

  @ManyToOne(() => AppUser, { fieldName: 'uploaded_by' })
  uploadedBy!: AppUser;

  @Property({ columnType: 'timestamptz', nullable: true })
  uploadedAt?: Date;
}

// doc_running_number — SELECT FOR UPDATE this row before increment (invariant 7).
@Entity({ tableName: 'doc_running_number' })
@Unique({ properties: ['company', 'documentType', 'year'] })
export class DocRunningNumber extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @ManyToOne(() => DocumentType)
  documentType!: DocumentType;

  @Property({ type: 'int' })
  year!: number;

  @Property({ nullable: true })
  prefix?: string;

  @Property({ type: 'int', default: 0 })
  currentNo: number = 0;
}


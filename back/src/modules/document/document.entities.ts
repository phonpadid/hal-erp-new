import { Entity, Enum, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { DocCategory, DocStatus } from '../../common/enums';
import { BaseEntity, CompanyScopedEntity } from '../../common/entities/base.entity';
import { Budget } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { Item, Vendor } from '../master-data/master-data.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser, Employee } from '../rbac/rbac.entities';
import { Workflow } from '../approval/approval.entities';
import { TaxCode } from '../tax/tax.entities';

// document_type — behavior is config: requires_budget / requires_quota / post_action.
@Entity({ tableName: 'document_type' })
export class DocumentType extends BaseEntity {
  @Property({ unique: true })
  code!: string;

  @Property()
  name!: string;

  @Enum({ items: () => DocCategory })
  category!: DocCategory;

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

  // CUT_BUDGET / CREATE_PO / UPDATE_EMPLOYEE / TERMINATE_EMPLOYEE
  @Property({ nullable: true })
  postAction?: string;

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

  @Property({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  grandTotal?: string;

  @Property({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  baseTaxTotal?: string;

  @Enum({ items: () => DocStatus, default: DocStatus.DRAFT })
  status: DocStatus = DocStatus.DRAFT;

  @Property({ columnType: 'timestamptz', nullable: true })
  submittedAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  approvedAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date;
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

  @Property({ nullable: true })
  glAccount?: string;

  // Accumulated received qty for 3-way matching.
  @Property({ type: 'decimal', precision: 15, scale: 4, default: 0 })
  receivedQty: string = '0';

  @Property({ default: 'OPEN' })
  lineStatus: string = 'OPEN';
}

// document_attachment — file lives in S3/MinIO; only the path is stored.
@Entity({ tableName: 'document_attachment' })
export class DocumentAttachment extends BaseEntity {
  @Index()
  @ManyToOne(() => Document)
  document!: Document;

  @Property()
  fileName!: string;

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

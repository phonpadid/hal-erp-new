import { Entity, Enum, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { ApproveAction, PendingSuccessorStatus } from '../../common/enums';
import { BaseEntity, CompanyScopedEntity } from '../../common/entities/base.entity';
import { Document } from '../document/document.entities';
import { DocumentType } from '../document/document.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser, Role, UserSignature } from '../rbac/rbac.entities';

@Entity({ tableName: 'workflow' })
export class Workflow extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @Property()
  name!: string;

  // Condition to select the workflow (amount band, job level, ...).
  @Property({ type: 'text', nullable: true })
  conditionJson?: string;

  @Property({ default: true })
  isActive: boolean = true;
}

@Entity({ tableName: 'workflow_step' })
@Unique({ properties: ['workflow', 'stepNo'] })
export class WorkflowStep extends BaseEntity {
  @ManyToOne(() => Workflow)
  workflow!: Workflow;

  @Property({ type: 'int' })
  stepNo!: number;

  @Property({ nullable: true })
  stepName?: string;

  @ManyToOne(() => Role, { fieldName: 'approver_role_id', nullable: true })
  approverRole?: Role;

  @ManyToOne(() => AppUser, { fieldName: 'approver_user_id', nullable: true })
  approverUser?: AppUser;

  // Step engages when base amount >= amountMin.
  @Property({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  amountMin?: string;

  @Property({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  amountMax?: string;

  // SEQUENTIAL / PARALLEL_ALL / PARALLEL_ANY
  @Property({ default: 'SEQUENTIAL' })
  approveMode: string = 'SEQUENTIAL';

  @Property({ type: 'int', nullable: true })
  slaHours?: number;

  // Whether this step's approval signature is drawn on the exported PDF. The number of
  // signature blocks = the count of flagged steps, so it is always <= the step count.
  // Purely a PDF-output concern — it never changes routing or approval. Default true.
  @Property({ default: true })
  showSignatureOnPdf: boolean = true;

  // Step engagement condition by requester position level, e.g. {"jobLevels":["MANAGER"]}.
  // Null/empty = no restriction (applies to every requester).
  @Property({ type: 'text', nullable: true })
  conditionJson?: string;
}

// approval_delegation — approve-on-behalf during absence. Cannot be chained (invariant 8).
@Entity({ tableName: 'approval_delegation' })
@Index({ properties: ['delegator', 'status'] })
@Index({ properties: ['company', 'delegate'] })
export class ApprovalDelegation extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @ManyToOne(() => AppUser, { fieldName: 'delegator_id' })
  delegator!: AppUser;

  @ManyToOne(() => AppUser, { fieldName: 'delegate_id' })
  delegate!: AppUser;

  // null = covers every document type.
  @ManyToOne(() => DocumentType, { nullable: true })
  documentType?: DocumentType;

  @Property({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  amountLimit?: string;

  @Property({ columnType: 'date' })
  startDate!: string;

  @Property({ columnType: 'date' })
  endDate!: string;

  @Property({ nullable: true })
  reason?: string;

  @Property({ default: 'ACTIVE' })
  status: string = 'ACTIVE';

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date;
}

// approval_log — APPEND-ONLY audit trail of every action (invariant 2).
@Entity({ tableName: 'approval_log' })
export class ApprovalLog extends BaseEntity {
  @Index()
  @ManyToOne(() => Document)
  document!: Document;

  @Property({ type: 'int' })
  stepNo!: number;

  @ManyToOne(() => AppUser, { fieldName: 'approver_id' })
  approver!: AppUser;

  @ManyToOne(() => AppUser, { fieldName: 'delegated_from', nullable: true })
  delegatedFrom?: AppUser;

  @Enum({ items: () => ApproveAction })
  action!: ApproveAction;

  // Snapshot of the approver's signature at APPROVE time — locked, never recomputed
  // (null for reject/return/delegate, or an approver with no signature on file).
  @ManyToOne(() => UserSignature, { fieldName: 'signature_id', nullable: true })
  signature?: UserSignature;

  @Property({ type: 'text', nullable: true })
  remark?: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  actedAt?: Date;
}

/**
 * pending_successor — the CREATE_SUCCESSOR outbox. A row is inserted in the same transaction
 * that marks the source document COMPLETED, so the obligation to create the successor commits
 * atomically with the approval and cannot be lost (approval-workflow: never half-applied). The
 * sweeper fulfils it afterwards, outside that transaction, so a broken successor configuration
 * can never retroactively fail an approval its approvers already granted.
 *
 * This is a work queue, NOT a ledger: rows are updated in place. Invariant 2 covers budget_txn
 * and approval_log, where history is the product; here the audit trail is the approval_log row
 * and the created document's own ref_document_id.
 */
@Entity({ tableName: 'pending_successor' })
@Index({ properties: ['status', 'createdAt'] })
export class PendingSuccessor extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @ManyToOne(() => Document, { fieldName: 'source_document_id' })
  sourceDocument!: Document;

  @ManyToOne(() => DocumentType, { fieldName: 'successor_type_id' })
  successorType!: DocumentType;

  /**
   * The department the successor is created in — resolved when the obligation is recorded, from
   * the pairing's `successor_department_id` or, when that is null, the source document's own
   * department. Resolved at record time rather than at sweep time so the row is a complete
   * instruction: editing a pairing afterwards cannot redirect a handoff the approvers already
   * granted. It also pins the successor's form template and workflow via `dept_doc_type`.
   */
  @ManyToOne(() => Department, { fieldName: 'department_id' })
  department!: Department;

  @Enum({ items: () => PendingSuccessorStatus })
  status: PendingSuccessorStatus = PendingSuccessorStatus.PENDING;

  @Property({ type: 'int', default: 0 })
  attempts: number = 0;

  @Property({ type: 'text', nullable: true })
  lastError?: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  updatedAt?: Date;
}

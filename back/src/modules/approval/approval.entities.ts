import { Entity, Enum, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { ApproveAction, PendingSuccessorStatus } from '../../common/enums';
import { BaseEntity, CompanyScopedEntity } from '../../common/entities/base.entity';
import { Document } from '../document/document.entities';
import { DocumentType } from '../document/document.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser, Role, UserSignature } from '../rbac/rbac.entities';


/**
 * A workflow is chosen by its `dept_doc_type` mapping alone. It carries no selection condition of
 * its own: one used to be stored here and read by nothing, so an administrator could author a rule,
 * see it echoed back, and route nothing by it. Every condition the routing engine evaluates lives on
 * `WorkflowStep` — the amount band and the requester's position level.
 */
@Entity({ tableName: 'workflow' })
export class Workflow extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @Property()
  name!: string;

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

  /**
   * Who may act on this step once its SLA has elapsed. Either-or, like the approver target.
   *
   * Escalation changes WHO, never WHETHER: the overdue step stays open and gains an actor. Leaving
   * both null means the step is chased rather than skipped — a missed deadline must not remove an
   * approval the amount band and the job-level condition said the document required.
   */
  @ManyToOne(() => Role, { fieldName: 'escalate_to_role_id', nullable: true })
  escalateToRole?: Role;

  @ManyToOne(() => AppUser, { fieldName: 'escalate_to_user_id', nullable: true })
  escalateToUser?: AppUser;

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

/** How a recorded route step stands. SKIPPED is reserved for a step an escalation passed over. */
export const ROUTE_STEP_STATUS = { PENDING: 'PENDING', DONE: 'DONE', SKIPPED: 'SKIPPED' } as const;

/**
 * document_approval_step — the route a document actually runs, resolved once at submit.
 *
 * Everything this codebase refuses to re-derive is stored as a copy, for the same reason each time:
 * the FX rate stamped at submit, the signature stamped at approval, the payee snapshot on a batch
 * line, the exact bytes sent to a bank. The approval route was the exception — a document
 * remembered `current_step_no` and read every other fact live from `workflow_step`, so an edit to
 * configuration reached documents already routing and nobody could say afterwards which chain a
 * document had run.
 *
 * The copied columns are copies deliberately. Joining `source_workflow_step_id` would give back
 * exactly the live read this table exists to stop; the id is there to trace the configuration used,
 * and goes null if that configuration is later deleted.
 */
@Entity({ tableName: 'document_approval_step' })
@Index({ properties: ['document'] })
export class DocumentApprovalStep extends BaseEntity {
  @ManyToOne(() => Document)
  document!: Document;

  @Property({ type: 'int' })
  stepNo!: number;

  @Property({ nullable: true })
  stepName?: string;

  @ManyToOne(() => Role, { fieldName: 'approver_role_id', nullable: true })
  approverRole?: Role;

  @ManyToOne(() => AppUser, { fieldName: 'approver_user_id', nullable: true })
  approverUser?: AppUser;

  @Property()
  approveMode: string = 'SEQUENTIAL';

  @Property({ type: 'int', nullable: true })
  slaHours?: number;

  /** Where this step escalates, copied from configuration at submit. */
  @ManyToOne(() => Role, { fieldName: 'escalate_to_role_id', nullable: true })
  escalateToRole?: Role;

  @ManyToOne(() => AppUser, { fieldName: 'escalate_to_user_id', nullable: true })
  escalateToUser?: AppUser;

  /**
   * Who the step was ACTUALLY escalated to, and when — the act, distinct from the configuration of
   * where it would go. Resolution treats this user as an eligible actor on the step alongside its
   * principals; it is deliberately NOT a `DocumentApprovalStepActor`, because that set is what a
   * PARALLEL_ALL step must cover and an escalation must never add a required approval.
   *
   * `escalatedAt` makes the act idempotent: a sweep every five minutes chases the approver every
   * five minutes and writes one `approval_log` row.
   */
  @ManyToOne(() => AppUser, { fieldName: 'escalated_to_user_id', nullable: true })
  escalatedToUser?: AppUser;

  @Property({ columnType: 'timestamptz', nullable: true })
  escalatedAt?: Date;

  @Property({ default: true })
  showSignatureOnPdf: boolean = true;

  @Property()
  status: string = ROUTE_STEP_STATUS.PENDING;

  /**
   * When this step OPENED — the base of its SLA clock.
   *
   * Not `document.submitted_at`: `sla_hours` is configured per step, so a step that inherits the
   * time an earlier step spent is overdue before its approver has seen it, and the sweep escalates
   * past them.
   */
  @Property({ columnType: 'timestamptz', nullable: true })
  startedAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  completedAt?: Date;

  /** Set when a resubmission replaces this route. The old rows stay: each attempt keeps its record. */
  @Property({ columnType: 'timestamptz', nullable: true })
  supersededAt?: Date;

  @ManyToOne(() => WorkflowStep, { fieldName: 'source_workflow_step_id', nullable: true })
  sourceWorkflowStep?: WorkflowStep;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date = new Date();
}

/**
 * The principals a step is waiting for, recorded when the step OPENS rather than at submit.
 *
 * A role change between a document being submitted and its third step opening should reach that
 * step. What must not move is the set while the step is being approved: `stepComplete` used to
 * resolve holders live, so a PARALLEL_ALL step needed one more approval than a minute ago if
 * someone was granted the role, and could complete on approvals from people who had since lost it.
 *
 * Delegation stays live and is not recorded here — it states who is available now, and freezing it
 * would route work to someone who went on leave after the step opened.
 */
@Entity({ tableName: 'document_approval_step_actor' })
@Unique({ properties: ['step', 'user'] })
export class DocumentApprovalStepActor extends BaseEntity {
  @ManyToOne(() => DocumentApprovalStep, { fieldName: 'step_id' })
  step!: DocumentApprovalStep;

  @ManyToOne(() => AppUser, { fieldName: 'user_id' })
  user!: AppUser;
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

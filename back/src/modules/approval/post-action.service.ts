import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { BudgetTxnType, DocStatus, PendingSuccessorStatus } from '../../common/enums';
import { Money } from '../../common/money/money';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetPlanService, PLAN_POST_ACTION } from '../budget/budget-plan.service';
import { BudgetMovement, BudgetTxn } from '../budget/budget.entities';
import { DocFieldValue, Document, DocumentLine, DocumentType } from '../document/document.entities';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
import { createEntry, SOURCE_MANUAL, SOURCE_REVERSAL } from '../gl/gl-posting.service';
import { JournalVoucher, JournalVoucherLine } from '../gl/journal-voucher.entities';
import { autoCreateSuccessorsFor } from '../document/ref-chain.config';
import { Company, Department } from '../multi-company/multi-company.entities';
import { EmployeeService } from '../rbac/employee.service';
import { StockMovementService } from '../inventory/stock-movement.service';
import { PendingSuccessor } from './approval.entities';

const FILTER_OFF = { filters: { company: false } } as const;

async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/** The post-action of the document type that carries a journal voucher. */
export const POST_JOURNAL = 'POST_JOURNAL';

/**
 * Runs a document type's post_action on full approval (invariant 7), inside the
 * approval transaction so it is atomic with the terminal transition. A bounded
 * retry covers transient faults; persistent failure propagates so the transaction
 * rolls back (the document is not left half-applied or stuck).
 */
@Injectable()
export class PostActionService {
  private readonly logger = new Logger(PostActionService.name);

  constructor(
    private readonly budget: BudgetLedgerService,
    private readonly em: EntityManager,
    // Optional: present in the running app (RbacModule); omitted in unit tests that don't
    // exercise the HR post-actions. Without it, promotion/resignation apply is skipped.
    @Optional() private readonly employees?: EmployeeService,
    // Optional for the same reason: a unit test that approves a non-stock document needs none.
    @Optional() private readonly stock?: StockMovementService,
    // Optional for the same reason again: only ACTIVATE_BUDGET reaches it.
    @Optional() private readonly plans?: BudgetPlanService,
    // Optional for the same reason once more: only POST_JOURNAL reaches it. Absent, that action
    // refuses rather than posting unguarded — see postJournal().
    @Optional() private readonly periods?: PeriodGuardService,
  ) {}

  async run(
    document: Document,
    tem: EntityManager,
  ): Promise<{ paymentReady: boolean; stockTxnIds: string[] }> {
    // Collected inside the transaction, emitted by the caller after it commits: GL posting must
    // not be able to roll back a movement its approvers already granted.
    const stockTxnIds: string[] = [];
    const docType = await tem.findOneOrFail(DocumentType, { id: document.documentType.id });
    const action = docType.postAction;
    if (!action) return { paymentReady: false, stockTxnIds };

    await retry(async () => {
      switch (action) {
        case 'CUT_BUDGET':
          return this.cutBudget(document, tem);
        case 'CREATE_SUCCESSOR':
          return this.recordSuccessorObligations(document, docType, tem);
        case 'TRANSFER':
          return this.transfer(document, tem);
        case 'ADJUST_INCREASE':
        case 'ADJUST_DECREASE':
          return this.adjust(document, action, tem);
        case PLAN_POST_ACTION:
          return this.activateBudgetPlan(document, tem);
        case 'ISSUE_STOCK':
        case 'ADJUST_STOCK':
        case 'TRANSFER_STOCK': {
          const written = await this.moveStock(document, action, tem);
          // Replaced, not appended: run() retries the whole action, so accumulating would emit
          // ids from an attempt that was rolled back.
          stockTxnIds.length = 0;
          stockTxnIds.push(...written);
          return;
        }
        case POST_JOURNAL:
          return this.postJournal(document, tem);
        case 'UPDATE_EMPLOYEE':
          return this.applyPromotion(document, tem);
        case 'TERMINATE_EMPLOYEE':
          return this.applyResignation(document, tem);
        default:
          return; // unknown post_action → no-op
      }
    });
    // A settled CUT_BUDGET document is now payable — signal payment-ready post-commit.
    return { paymentReady: action === 'CUT_BUDGET', stockTxnIds };
  }

  /**
   * Apply the document's stock movement, inside the approval transaction so it is atomic with the
   * terminal transition (never half-applied).
   *
   * Re-reads the demand from the document's own lines rather than trusting anything cached: the
   * lines are immutable once submitted, and re-deriving keeps this path identical to the one that
   * took the reservation, so the quantities cannot drift apart.
   */
  private async moveStock(
    document: Document,
    action: string,
    tem: EntityManager,
  ): Promise<string[]> {
    if (!this.stock) return [];
    const doc = await tem.findOneOrFail(
      Document,
      { id: document.id },
      { populate: ['warehouse', 'destWarehouse'], ...FILTER_OFF },
    );
    if (!doc.warehouse) {
      throw new BadRequestException(`A ${action} document reached approval without a warehouse`);
    }

    if (action === 'ADJUST_STOCK') {
      // No reservation was taken at submit, so there is nothing to convert — the adjustment is
      // applied directly, and a decrease is checked against the balance here.
      const written = await this.stock.adjust(tem, doc, doc.warehouse.id);
      return written.map((t) => t.id);
    }

    const demand = await this.stock.demandFor(tem, doc, doc.warehouse.id);
    if (action === 'TRANSFER_STOCK') {
      if (!doc.destWarehouse) {
        throw new BadRequestException('A TRANSFER_STOCK document reached approval without a destination');
      }
      // The reservation taken at submit is discharged by the TRANSFER_OUT, exactly as an issue
      // discharges its own.
      const moved = await this.stock.transfer(tem, demand, doc.destWarehouse.id);
      return moved.map((t) => t.id);
    }

    const issued = await this.stock.issue(tem, demand);
    return issued.map((t) => t.id);
  }

  /**
   * Record — inside the approval transaction — one PENDING `pending_successor` row for EACH
   * `document_type_ref` pairing marked `auto_create=true` (zero, one, or many). Pairings with
   * `auto_create=false` are left for manual create-from. `SuccessorSweeper` fulfils the rows
   * afterwards with `createFrom`.
   *
   * The successor is NOT created here. `createFrom` requires its predecessor to be APPROVED or
   * COMPLETED, a state this document only reaches when this very transaction commits; and a
   * downstream type's health must not be able to veto an approval its approvers already granted.
   * Recording the obligation is what satisfies approval-workflow's never-half-applied rule: the
   * document and everything it owes commit together, so a COMPLETED document always carries a
   * durable record of the successor it owes. If this insert fails, the bounded retry in run()
   * exhausts and the terminal transition rolls back — an approval whose obligation went
   * unrecorded is exactly the half-applied state the rule forbids.
   *
   * An INACTIVE successor type yields no obligation at all: deactivating a type is an admin
   * saying "stop using this", so not creating it is compliance, not a fault. Keeping it out of
   * the outbox is what lets FAILED keep meaning "the system promised something and could not
   * deliver" — the only reading that makes the state worth reporting on.
   */
  private async recordSuccessorObligations(
    document: Document,
    docType: DocumentType,
    tem: EntityManager,
  ): Promise<void> {
    const pairings = await autoCreateSuccessorsFor(tem, document.company.id, docType.id);
    const owed = pairings.filter((p) => p.successorType.isActive);
    for (const skipped of pairings.filter((p) => !p.successorType.isActive)) {
      this.logger.log(
        `CREATE_SUCCESSOR skip for ${document.id}: successor type '${skipped.successorType.code}' not active`,
      );
    }
    if (owed.length === 0) {
      this.logger.log(
        `CREATE_SUCCESSOR no-op for ${document.id}: no active auto_create successor for '${docType.code}'`,
      );
      return;
    }
    const now = new Date();
    for (const pairing of owed) {
      // The department resolves here, not at sweep time, so the obligation is a complete
      // instruction: a pairing edited later cannot redirect an already-approved handoff.
      const department = pairing.successorDepartment ?? document.department;
      tem.create(PendingSuccessor, {
        company: tem.getReference(Company, document.company.id),
        sourceDocument: tem.getReference(Document, document.id),
        successorType: tem.getReference(DocumentType, pairing.successorType.id),
        department: tem.getReference(Department, department.id),
        status: PendingSuccessorStatus.PENDING,
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
      this.logger.log(
        `CREATE_SUCCESSOR owes ${pairing.successorType.code} from ${document.docNo} in dept ${department.id} (pending_successor)`,
      );
    }
  }

  /**
   * Settle the document's budgeted lines to actuals. Reservations are keyed by the document
   * that made them, so for a disbursement that references a PR/PO chain we settle the
   * reserving ancestor's reservation (walk ref_document_id back to the holder); a document
   * that reserved itself settles its own (backward compatible). Amounts are aggregated per
   * budget so a budget is settled once.
   */
  private async cutBudget(document: Document, tem: EntityManager): Promise<void> {
    const lines = await tem.find(DocumentLine, { document: document.id }, { ...FILTER_OFF, populate: ['budget'] });
    // A settlement type (post_action CUT_BUDGET, e.g. DISB) is typically requires_budget=false, so
    // resolveLineGlAndBudget drops the budget from its own lines — only the reserving ancestor's
    // lines carry it. create-from copies the chain 1:1 (lineNo preserved), so fall back to the
    // ancestor's budget at the same lineNo. Without this, an item-backed PR→PO→DISB chain settles
    // nothing and the reservation is stranded as RESERVE forever. A line that already carries a
    // budget (a single self-reserving CUT_BUDGET document) keeps using its own — backward compatible.
    const ancestorBudgetByLine = await this.reservingAncestorBudgetByLine(document, tem);
    const byBudget = new Map<string, string>();
    for (const line of lines) {
      const budgetId = line.budget?.id ?? ancestorBudgetByLine.get(line.lineNo);
      if (!budgetId) continue;
      // Settle on the same budget base (BUDGET_RATE) that was reserved at submit.
      const amount = line.budgetBaseLineAmount ?? line.baseLineAmount ?? '0';
      byBudget.set(budgetId, Money.add(byBudget.get(budgetId) ?? '0', amount));
    }
    for (const [budgetId, amount] of byBudget) {
      if (Money.compare(amount, '0') <= 0) continue;
      const reservingDocId = await this.resolveReservingDocument(document, budgetId, tem);
      await this.budget.settle(reservingDocId, budgetId, amount, tem);
    }
  }

  /**
   * Budget id keyed by lineNo, taken from the nearest ref-chain ancestor that actually reserved
   * budget. A settlement type is usually requires_budget=false so its own lines lost their budget;
   * create-from copies the chain 1:1 (lineNo preserved), so the ancestor's line at the same lineNo
   * names the budget whose reservation this settlement converts. Empty map when no ancestor reserved
   * (a self-reserving CUT_BUDGET document then settles on its own line budgets).
   */
  private async reservingAncestorBudgetByLine(document: Document, tem: EntityManager): Promise<Map<number, string>> {
    const byLine = new Map<number, string>();
    const start = await tem.findOne(Document, { id: document.id }, { ...FILTER_OFF, populate: ['refDocument'] });
    let currentId: string | undefined = start?.refDocument?.id;
    const seen = new Set<string>();
    while (currentId && !seen.has(currentId)) {
      seen.add(currentId);
      const reserved = await tem.findOne(
        BudgetTxn,
        { document: currentId, txnType: BudgetTxnType.RESERVE },
        FILTER_OFF,
      );
      if (reserved) {
        const ancestorLines = await tem.find(DocumentLine, { document: currentId }, { ...FILTER_OFF, populate: ['budget'] });
        for (const l of ancestorLines) if (l.budget) byLine.set(l.lineNo, l.budget.id);
        return byLine;
      }
      const doc = await tem.findOne(Document, { id: currentId }, { ...FILTER_OFF, populate: ['refDocument'] });
      currentId = doc?.refDocument?.id;
    }
    return byLine;
  }

  /** The document (self or nearest ref-chain ancestor) holding a RESERVE on this budget. */
  private async resolveReservingDocument(document: Document, budgetId: string, tem: EntityManager): Promise<string> {
    let currentId: string | undefined = document.id;
    const seen = new Set<string>();
    while (currentId && !seen.has(currentId)) {
      seen.add(currentId);
      const reserve = await tem.findOne(
        BudgetTxn,
        { document: currentId, budget: budgetId, txnType: BudgetTxnType.RESERVE },
        FILTER_OFF,
      );
      if (reserve) return currentId;
      const doc = await tem.findOne(Document, { id: currentId }, { ...FILTER_OFF, populate: ['refDocument'] });
      currentId = doc?.refDocument?.id;
    }
    return document.id; // fallback: no upstream reservation found
  }

  /**
   * Put an approved budget plan's budgets in force.
   *
   * The first post-action that reads MANY `budget_movement` rows for one document. `movementOf`
   * below is `findOne` and stays that way: transfer and adjust each carry exactly one movement, and
   * widening it would turn a plan's second line into a silently ignored one.
   *
   * Missing the service is a hard failure rather than a skip: skipping would mark the document
   * COMPLETED with its budgets still DRAFT, which reads as an approval that did nothing.
   */
  private async activateBudgetPlan(document: Document, tem: EntityManager): Promise<void> {
    if (!this.plans) {
      throw new BadRequestException(
        `Budget plan ${document.id} was approved but no budget plan service is wired in to activate it`,
      );
    }
    await this.plans.activate(document, tem);
  }

  private async movementOf(document: Document, tem: EntityManager): Promise<BudgetMovement> {
    const movement = await tem.findOne(BudgetMovement, { document: document.id }, FILTER_OFF);
    if (!movement) {
      throw new BadRequestException(`No budget_movement for document ${document.id}`);
    }
    return movement;
  }

  private async transfer(document: Document, tem: EntityManager): Promise<void> {
    const m = await this.movementOf(document, tem);
    if (!m.fromBudget || !m.toBudget) {
      throw new BadRequestException('Transfer movement needs both from and to budgets');
    }
    await this.budget.executeTransfer(
      {
        documentId: document.id,
        fromBudgetId: m.fromBudget.id,
        toBudgetId: m.toBudget.id,
        amount: m.amount,
        // The movement already states when it takes effect; the ledger rows it produces should say
        // the same day rather than the day the approval happened to land.
        effectiveDate: m.effectiveDate,
      },
      tem,
    );
  }

  private async adjust(
    document: Document,
    movementType: 'ADJUST_INCREASE' | 'ADJUST_DECREASE',
    tem: EntityManager,
  ): Promise<void> {
    const m = await this.movementOf(document, tem);
    const budgetId = m.toBudget?.id ?? m.fromBudget?.id;
    if (!budgetId) throw new BadRequestException('Adjustment movement needs a budget');
    await this.budget.executeAdjustment(
      { documentId: document.id, budgetId, amount: m.amount, movementType, effectiveDate: m.effectiveDate },
      tem,
    );
  }

  /** The document's field values keyed by their form field's name (the HR contract). */
  private async hrFields(documentId: string, tem: EntityManager): Promise<Record<string, string | undefined>> {
    const values = await tem.find(DocFieldValue, { document: documentId }, { ...FILTER_OFF, populate: ['formField'] });
    const out: Record<string, string | undefined> = {};
    for (const v of values) out[v.formField.fieldName] = v.fieldValue;
    return out;
  }

  /**
   * UPDATE_EMPLOYEE: promote the document's related employee from its field values
   * (new_position / new_salary / new_job_level), recording effective_date. No-op when the
   * document has no related employee. A non-decimal salary fails (the approval rolls back).
   */
  private async applyPromotion(document: Document, tem: EntityManager): Promise<void> {
    if (!document.relatedEmployee || !this.employees) {
      if (!document.relatedEmployee) this.logger.log(`UPDATE_EMPLOYEE no-op for ${document.id}: no related employee`);
      return;
    }
    const f = await this.hrFields(document.id, tem);
    const salary = f['new_salary'];
    if (salary != null && salary !== '' && !/^\d+(\.\d+)?$/.test(salary)) {
      throw new BadRequestException(`UPDATE_EMPLOYEE: invalid salary '${salary}'`);
    }
    await this.employees.applyPromotion(
      document.relatedEmployee.id,
      {
        position: f['new_position'] || undefined,
        jobLevel: f['new_job_level'] || undefined,
        salary: salary && salary !== '' ? salary : undefined,
      },
      document.company.id,
      tem,
    );
  }

  /**
   * TERMINATE_EMPLOYEE: close the document's related employee (RESIGNED) and expire that
   * company's role memberships as of the effective_date field. No-op when no related employee.
   */
  private async applyResignation(document: Document, tem: EntityManager): Promise<void> {
    if (!document.relatedEmployee || !this.employees) {
      if (!document.relatedEmployee) this.logger.log(`TERMINATE_EMPLOYEE no-op for ${document.id}: no related employee`);
      return;
    }
    const f = await this.hrFields(document.id, tem);
    await this.employees.applyResignation(document.relatedEmployee.id, f['effective_date'] || undefined, document.company.id, tem);
  }

  /**
   * Post the journal voucher this document carries.
   *
   * Everything about how the entry is written is `createEntry`'s: balance, the company's calendar
   * day, the closed-period refusal, append-only. What this decides is only which facts go in.
   *
   * The entry is dated the VOUCHER's date, not any approval's — the voucher states an accounting
   * fact and the moment an approver reached it is not one — and authored by the document's CREATOR,
   * because an entry is what its preparer wrote. The approvals are control events about it and they
   * live in `approval_log`, which records every step rather than only the last decision.
   *
   * No `budget_txn` and no posting attempt, for the reasons a voucher always gave: an accountant
   * correcting the ledger is not adjusting anyone's budget, and this is a person's synchronous act
   * rather than work the system owes itself.
   */
  private async postJournal(document: Document, tem: EntityManager): Promise<void> {
    if (!this.periods) {
      throw new BadRequestException(
        'POST_JOURNAL needs the accounting-period guard, which is not wired into this context',
      );
    }
    const voucher = await this.requireVoucher(document, tem);
    const lines = await tem.find(
      JournalVoucherLine,
      { voucher: voucher.id },
      { ...FILTER_OFF, populate: ['account'] },
    );
    const company = await tem.findOneOrFail(Company, { id: document.company.id }, FILTER_OFF);

    const sourceType = voucher.reversesEntryId ? SOURCE_REVERSAL : SOURCE_MANUAL;
    const sourceId = voucher.reversesEntryId ?? voucher.id;
    await createEntry(
      tem,
      {
        company,
        // Midday, so converting to the company's calendar day cannot land on a neighbouring one:
        // the preparer named a DATE, and a date is all they named.
        instant: new Date(`${voucher.entryDate}T12:00:00Z`),
        sourceType,
        sourceId,
        memo: voucher.memo,
        createdById: document.createdBy.id,
        lines: lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit })),
      },
      this.periods,
    );
  }

  /**
   * Refuse an approval that could not post, BEFORE it is recorded.
   *
   * The posting happens in the approval transaction, so without this the period is checked at the
   * moment of posting — after every approver but the last has already approved. The last one's
   * action would then be rolled back with an error about a period they did not choose and cannot
   * open, leaving the document at a step whose approval can never commit.
   *
   * This does not replace the check inside `createEntry`, which is the invariant. A period can
   * close between this check and the commit; what this removes is the ordinary case, not the race.
   */
  async assertApprovable(document: Document, tem: EntityManager): Promise<void> {
    const docType = await tem.findOneOrFail(DocumentType, { id: document.documentType.id });
    if (docType.postAction !== POST_JOURNAL || !this.periods) return;
    const voucher = await tem.findOne(
      JournalVoucher,
      { document: document.id },
      FILTER_OFF,
    );
    if (!voucher) return;
    const closed = await this.periods.closedPeriodOn(tem, document.company.id, voucher.entryDate);
    if (closed) {
      throw new BadRequestException(
        `Accounting period ${closed.periodStart} to ${closed.periodEnd} closed while this voucher ` +
          `was in approval, so it can no longer be posted on ${voucher.entryDate}. Its author must ` +
          'cancel it and raise it again with a date in an open period.',
      );
    }
  }

  private async requireVoucher(document: Document, tem: EntityManager): Promise<JournalVoucher> {
    const voucher = await tem.findOne(JournalVoucher, { document: document.id }, FILTER_OFF);
    if (!voucher) {
      throw new BadRequestException(
        `Document ${document.id} posts a journal but carries no voucher`,
      );
    }
    return voucher;
  }
}

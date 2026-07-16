import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { BudgetTxnType, DocStatus } from '../../common/enums';
import { Money } from '../../common/money/money';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetMovement, BudgetTxn } from '../budget/budget.entities';
import { DocFieldValue, Document, DocumentLine, DocumentType } from '../document/document.entities';
import { DocumentService } from '../document/document.service';
import { autoCreateSuccessorsFor } from '../document/ref-chain.config';
import { EmployeeService } from '../rbac/employee.service';

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
    // Optional: present in the running app (DocumentEngineModule); omitted in unit tests that
    // don't exercise CREATE_SUCCESSOR. Without it, successor auto-creation is skipped.
    @Optional() private readonly documents?: DocumentService,
    // Optional: present in the running app (RbacModule); omitted in unit tests that don't
    // exercise the HR post-actions. Without it, promotion/resignation apply is skipped.
    @Optional() private readonly employees?: EmployeeService,
  ) {}

  async run(document: Document, tem: EntityManager): Promise<{ paymentReady: boolean }> {
    const docType = await tem.findOneOrFail(DocumentType, { id: document.documentType.id });
    const action = docType.postAction;
    // CREATE_SUCCESSOR creates its DRAFT successors post-commit (createSuccessorIfConfigured), not
    // in this transaction, so it is a no-op here.
    if (!action || action === 'CREATE_SUCCESSOR') return { paymentReady: false };

    await retry(async () => {
      switch (action) {
        case 'CUT_BUDGET':
          return this.cutBudget(document, tem);
        case 'TRANSFER':
          return this.transfer(document, tem);
        case 'ADJUST_INCREASE':
        case 'ADJUST_DECREASE':
          return this.adjust(document, action, tem);
        case 'UPDATE_EMPLOYEE':
          return this.applyPromotion(document, tem);
        case 'TERMINATE_EMPLOYEE':
          return this.applyResignation(document, tem);
        default:
          return; // unknown post_action → no-op
      }
    });
    // A settled CUT_BUDGET document is now payable — signal payment-ready post-commit.
    return { paymentReady: action === 'CUT_BUDGET' };
  }

  /**
   * Post-commit (after the approval transaction): if the completed document's type `post_action`
   * is CREATE_SUCCESSOR, auto-create a DRAFT successor from it for EACH `document_type_ref`
   * pairing marked `auto_create=true` (zero, one, or many). Pairings with `auto_create=false` are
   * left for manual create-from. Best-effort — a failure leaves the (already committed) approval
   * intact; successors can still be created manually. Each successor is a DRAFT (no ledger
   * effect), so post-commit is safe.
   */
  async createSuccessorIfConfigured(documentId: string): Promise<void> {
    try {
      const em = this.em.fork();
      if (!this.documents) return;
      const document = await em.findOne(Document, { id: documentId }, { ...FILTER_OFF, populate: ['documentType'] });
      if (!document || document.status !== DocStatus.COMPLETED) return;
      const type = await em.findOneOrFail(DocumentType, { id: document.documentType.id });
      if (type.postAction !== 'CREATE_SUCCESSOR') return;

      // Auto-create every successor whose pairing is marked auto_create, scoped to the document's
      // company. Zero pairings → logged no-op; inactive successor types are skipped.
      const successors = await autoCreateSuccessorsFor(em, document.company.id, type.id);
      if (successors.length === 0) {
        this.logger.log(`CREATE_SUCCESSOR no-op for ${documentId}: no auto_create successor for '${type.code}'`);
        return;
      }
      for (const successorType of successors) {
        if (!successorType.isActive) {
          this.logger.log(`CREATE_SUCCESSOR skip for ${documentId}: successor type '${successorType.code}' not active`);
          continue;
        }
        const successor = await this.documents.createFrom(documentId, successorType.id);
        this.logger.log(`CREATE_SUCCESSOR created ${successorType.code} ${successor.docNo} from ${document.docNo}`);
      }
    } catch (e) {
      this.logger.error(`CREATE_SUCCESSOR failed for ${documentId}: ${(e as Error).message}`);
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
    const byBudget = new Map<string, string>();
    for (const line of lines) {
      if (line.budget) {
        // Settle on the same budget base (BUDGET_RATE) that was reserved at submit.
        const amount = line.budgetBaseLineAmount ?? line.baseLineAmount ?? '0';
        byBudget.set(line.budget.id, Money.add(byBudget.get(line.budget.id) ?? '0', amount));
      }
    }
    for (const [budgetId, amount] of byBudget) {
      if (Money.compare(amount, '0') <= 0) continue;
      const reservingDocId = await this.resolveReservingDocument(document, budgetId, tem);
      await this.budget.settle(reservingDocId, budgetId, amount, tem);
    }
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
      { documentId: document.id, fromBudgetId: m.fromBudget.id, toBudgetId: m.toBudget.id, amount: m.amount },
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
      { documentId: document.id, budgetId, amount: m.amount, movementType },
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
}

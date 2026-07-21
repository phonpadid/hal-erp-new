import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { DocStatus } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Document, DocumentLine } from '../document/document.entities';
import { Payment, PaymentAttachment, PaymentBatchLine } from './payment.entities';

/** Per-document transfer-slip state, for the documents list. Only CUT_BUDGET documents can carry
 *  a slip; a document not in the returned map is not a payable and shows nothing. */
export type SlipStatus = 'PENDING' | 'UPLOADED';

/** Batch states that still hold their payables — a terminal batch releases them again. */
const OPEN_BATCH_STATUSES = ['DRAFT', 'EXPORTED'] as const;

const FILTER_OFF = { filters: { company: false } } as const;

export interface PayableHandoff {
  documentId: string;
  docNo: string;
  vendorId?: string;
  vendorName?: string;
  /** The approved destination — chosen on the document, not here. */
  payee?: {
    bankAccountId: string;
    bankCode: string;
    accountNo: string;
    accountName: string;
  };
  baseAmount: string;
  glAccounts: string[];
}

/**
 * The ready-to-pay queue: settled disbursements (COMPLETED documents whose type
 * `post_action` is CUT_BUDGET) for an external accounting system to pull, and for a payment batch
 * to draw from. Derived, not stored, and company-scoped. The payable amount is the disbursement's
 * settled base total.
 *
 * A payable leaves the queue when it has a `payment` OR when an open batch already holds it. That
 * second rule is what stops one payable reaching the bank on two files: the unique constraint on
 * `payment.document_id` would catch the double only at import, long after the money moved.
 */
@Injectable()
export class PaymentHandoffService {
  constructor(
    private readonly em: EntityManager,
    private readonly scope: CompanyScopeService,
  ) {}

  async readyToPay(): Promise<PayableHandoff[]> {
    const scoped = this.scope.forActiveCompany();
    const completed = await scoped.find(
      Document,
      { status: DocStatus.COMPLETED },
      { populate: ['documentType', 'vendor', 'vendorBankAccount'] },
    );
    const cutBudget = completed.filter((d) => d.documentType.postAction === 'CUT_BUDGET');
    if (cutBudget.length === 0) return [];

    // Exclude disbursements already recorded as paid — the queue is what's still owed.
    const paid = await this.em
      .fork()
      .find(Payment, { document: { $in: cutBudget.map((d) => d.id) } }, FILTER_OFF);
    const paidIds = new Set(paid.map((p) => p.document.id));

    // ...and those an open batch already holds, so a payable cannot be exported twice. A cancelled
    // or completed batch releases its unpaid lines back here on its own — no requeue logic.
    const held = await this.em.fork().find(
      PaymentBatchLine,
      {
        document: { $in: cutBudget.map((d) => d.id) },
        batch: { status: { $in: [...OPEN_BATCH_STATUSES] } },
      },
      FILTER_OFF,
    );
    const heldIds = new Set(held.map((l) => l.document.id));

    const payables = cutBudget.filter((d) => !paidIds.has(d.id) && !heldIds.has(d.id));
    if (payables.length === 0) return [];

    const lines = await this.em
      .fork()
      .find(DocumentLine, { document: { $in: payables.map((d) => d.id) } }, FILTER_OFF);
    const glByDoc = new Map<string, Set<string>>();
    for (const l of lines) {
      if (!l.glAccount) continue;
      let set = glByDoc.get(l.document.id);
      if (!set) {
        set = new Set();
        glByDoc.set(l.document.id, set);
      }
      set.add(l.glAccount);
    }

    return payables.map((d) => ({
      documentId: d.id,
      docNo: d.docNo,
      vendorId: d.vendor?.id,
      vendorName: d.vendor?.name,
      payee: d.vendorBankAccount
        ? {
            bankAccountId: d.vendorBankAccount.id,
            bankCode: d.vendorBankAccount.bankCode,
            accountNo: d.vendorBankAccount.accountNo,
            accountName: d.vendorBankAccount.accountName,
          }
        : undefined,
      baseAmount: d.baseTotalAmount ?? '0',
      glAccounts: [...(glByDoc.get(d.id) ?? [])],
    }));
  }

  /**
   * Transfer-slip state for a set of documents, for the documents-list status column. Only a
   * CUT_BUDGET document ever carries a slip (same rule as the ready-to-pay queue), so any other
   * requested id is simply omitted from the result — the list shows nothing for it.
   *
   * Truth is two set-existence checks, company-scoped: a `payment` row (a payment was recorded)
   * and a `payment_attachment` for it (a slip was uploaded). UPLOADED needs both; everything else
   * (no payment yet, or paid but no slip) is PENDING. Whole page in three queries, not N reads.
   */
  async slipStatus(documentIds: string[]): Promise<Record<string, SlipStatus>> {
    const ids = [...new Set(documentIds)];
    if (!ids.length) return {};

    const scoped = this.scope.forActiveCompany();
    const docs = await scoped.find(Document, { id: { $in: ids } }, { populate: ['documentType'] });
    // A slip is only ever expected for a disbursement (CUT_BUDGET post-action).
    const payableIds = docs.filter((d) => d.documentType.postAction === 'CUT_BUDGET').map((d) => d.id);
    if (!payableIds.length) return {};

    const em = this.em.fork();
    const payments = await em.find(Payment, { document: { $in: payableIds } }, FILTER_OFF);
    const paymentIdByDoc = new Map(payments.map((p) => [p.document.id, p.id]));
    const attachments = payments.length
      ? await em.find(PaymentAttachment, { payment: { $in: payments.map((p) => p.id) } }, FILTER_OFF)
      : [];
    const paymentIdsWithSlip = new Set(attachments.map((a) => a.payment.id));

    const result: Record<string, SlipStatus> = {};
    for (const id of payableIds) {
      const paymentId = paymentIdByDoc.get(id);
      result[id] = paymentId && paymentIdsWithSlip.has(paymentId) ? 'UPLOADED' : 'PENDING';
    }
    return result;
  }
}

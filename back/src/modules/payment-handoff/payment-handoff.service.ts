import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocumentLine } from '../document/document.entities';
import { type PayableKind } from '../gl/payables';
import { owedDocuments } from './owed';
import { Payment, PaymentAttachment } from './payment.entities';

/** Per-document transfer-slip state, for the documents list. A document not in the returned map is
 *  not something the company owes, and shows nothing. */
export type SlipStatus = 'PENDING' | 'UPLOADED';

const FILTER_OFF = { filters: { company: false } } as const;

export interface PayableHandoff {
  documentId: string;
  docNo: string;
  /**
   * Which payable this is. `TRADE` is owed to a supplier, `CLAIM` to a person, and `null` to a
   * document whose type is paid without booking a payable first — the reader is told that too
   * rather than being left to infer it from an empty payee.
   */
  payableKind: PayableKind | null;
  /** Who is owed. The vendor, or the person a claim relates to, or absent when neither is named. */
  owedTo?: string;
  vendorId?: string;
  vendorName?: string;
  /** The approved destination — chosen on the document, not here. Claims have none. */
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
 * The ready-to-pay queue: everything the company owes and has not paid, whoever is owed it.
 *
 * ONE queue, from the one predicate in `owed.ts` — which the record endpoint also calls, so the
 * queue can never offer an action the endpoint would refuse. Before this there were two queues over
 * two configuration flags: one listed `CUT_BUDGET` documents and the other listed accruing ones, so
 * a type that was both appeared in both, and acting on it in the second could only fail.
 *
 * Derived, not stored, and company-scoped.
 */
@Injectable()
export class PaymentHandoffService {
  constructor(
    private readonly em: EntityManager,
    private readonly scope: CompanyScopeService,
  ) {}

  async readyToPay(): Promise<PayableHandoff[]> {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    const payables = await owedDocuments(this.scope.forActiveCompany(), em, companyId);
    if (payables.length === 0) return [];

    const lines = await em.find(
      DocumentLine,
      { document: { $in: payables.map((p) => p.document.id) } },
      FILTER_OFF,
    );
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

    return payables.map(({ document: d, accrued }) => ({
      documentId: d.id,
      docNo: d.docNo,
      payableKind: accrued?.kind ?? null,
      // The vendor, or the person the document relates to. Never the document's author: whoever
      // raised a claim is frequently not whoever is owed it, and naming the wrong payee is worse
      // than naming none.
      owedTo: d.vendor?.name ?? d.relatedEmployee?.fullName,
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
      // What the accrual booked when there was one; the document's settled base otherwise.
      baseAmount: accrued?.amount ?? d.baseTotalAmount ?? '0',
      glAccounts: [...(glByDoc.get(d.id) ?? [])],
    }));
  }

  /**
   * Transfer-slip state for a set of documents, for the documents-list status column. A document
   * the company does not owe never carries a slip, so any other requested id is simply omitted
   * from the result — the list shows nothing for it.
   *
   * Truth is two set-existence checks, company-scoped: a `payment` row (a payment was recorded)
   * and a `payment_attachment` for it (a slip was uploaded). UPLOADED needs both; everything else
   * (no payment yet, or paid but no slip) is PENDING. Whole page in a few queries, not N reads.
   */
  async slipStatus(documentIds: string[]): Promise<Record<string, SlipStatus>> {
    const ids = [...new Set(documentIds)];
    if (!ids.length) return {};

    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    // Everything the company owes among these ids, plus those already paid — a paid document has
    // left `owedDocuments` but is exactly the one whose slip state is being asked about.
    const owed = await owedDocuments(this.scope.forActiveCompany(), em, companyId, ids);
    const alreadyPaid = await em.find(Payment, { document: { $in: ids } }, FILTER_OFF);
    const payableIds = [
      ...new Set([...owed.map((o) => o.document.id), ...alreadyPaid.map((p) => p.document.id)]),
    ];
    if (!payableIds.length) return {};

    const payments = alreadyPaid;
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

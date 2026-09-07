import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocumentLine } from '../document/document.entities';
import { type PayableKind } from '../gl/payables';
import { owedDocuments } from './owed';
import { Payment, PaymentAttachment } from './payment.entities';
import type { TransferSource } from '@erp/shared';

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
  /**
   * The exchange rate stamped on the document at submit, reported as stamped and never recomputed
   * (invariant 6). Carried so the record-payment form can start the actual rate at the figure the
   * document already holds instead of asking finance to retype it — which is where a digit gets
   * dropped. What finance submits is still what is recorded; this is a starting point, not a
   * default the server substitutes.
   */
  lockedRate: string;
  /**
   * Which of the company's own accounts the document's transfer slip says the money left, when a
   * slip has said it. Carried so the record-payment form arrives with the question already
   * answered: in practice finance states it while attaching the slip at the approval step that
   * demands one, and asking again at record time is asking the same person twice about a transfer
   * they can no longer see. Absent when no slip states it.
   */
  statedTransferFrom?: TransferSource;
  /**
   * The rate the document's transfer slip says the money actually converted at, when a slip has
   * said it. Carried for the same reason as `statedTransferFrom`: the person who paid keyed it when
   * they attached the slip, and the record form should show that figure rather than ask for it
   * again. Absent when no slip states one, in which case the form falls back to `lockedRate`.
   */
  statedActualRate?: string;
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
    // What the slips already say about which account paid — one read for the whole page, like the
    // GL accounts below. Newest first, so a later slip correcting an earlier one is what wins.
    const attachments = await em.find(
      PaymentAttachment,
      { document: { $in: payables.map((p) => p.document.id) } },
      {
        ...FILTER_OFF,
        fields: ['document', 'transferFrom', 'actualRate', 'uploadedAt'],
        orderBy: { uploadedAt: 'DESC' },
      },
    );
    const statedByDoc = new Map<string, TransferSource>();
    const rateByDoc = new Map<string, string>();
    for (const a of attachments) {
      if (a.transferFrom && !statedByDoc.has(a.document.id)) statedByDoc.set(a.document.id, a.transferFrom);
      if (a.actualRate && !rateByDoc.has(a.document.id)) rateByDoc.set(a.document.id, a.actualRate);
    }

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
      // As stamped at submit. `?? '1'` is the same fallback the record endpoint applies, so the
      // figure the form offers is the one the server would have divided by.
      lockedRate: d.exchangeRate ?? '1',
      statedTransferFrom: statedByDoc.get(d.id),
      statedActualRate: rateByDoc.get(d.id),
      glAccounts: [...(glByDoc.get(d.id) ?? [])],
    }));
  }

  /**
   * Transfer-slip state for a set of documents, for the documents-list status column. A document
   * the company does not owe never carries a slip, so any other requested id is simply omitted
   * from the result — the list shows nothing for it.
   *
   * Truth is one set-existence check, company-scoped: a `payment_attachment` naming the document.
   * UPLOADED means evidence exists; PENDING means it does not. A recorded payment is deliberately
   * NOT part of the condition. A slip can now be attached during approval, before any payment is
   * recorded, and under the old rule ("a payment AND a slip") such a document reported PENDING while
   * its slip sat in storage — the column would have stated the opposite of what was stored, for
   * exactly the documents the mid-approval requirement exists to serve. The column asks whether the
   * transfer is evidenced; this answers that.
   *
   * Whole page in a few queries, not N reads.
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
    // One read, keyed by the document the slip names — which every slip carries, whether or not a
    // payment for it exists yet.
    const attachments = await em.find(
      PaymentAttachment,
      { document: { $in: ids } },
      { ...FILTER_OFF, fields: ['document'] },
    );
    const documentIdsWithSlip = new Set(attachments.map((a) => a.document.id));

    // A document with a slip always has an answer, whether or not it is payable yet: evidence can
    // now be attached during approval, and a document that carries some is not "no entry, show a
    // dash" — it is UPLOADED. The owed/paid sets still decide who gets a PENDING, so a document the
    // company does not owe and has never evidenced stays absent from the result.
    const payableIds = [
      ...new Set([
        ...owed.map((o) => o.document.id),
        ...alreadyPaid.map((p) => p.document.id),
        ...documentIdsWithSlip,
      ]),
    ];
    if (!payableIds.length) return {};

    const result: Record<string, SlipStatus> = {};
    for (const id of payableIds) {
      result[id] = documentIdsWithSlip.has(id) ? 'UPLOADED' : 'PENDING';
    }
    return result;
  }
}

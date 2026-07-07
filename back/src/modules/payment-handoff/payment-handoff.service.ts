import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { DocStatus } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Document, DocumentLine } from '../document/document.entities';
import { Payment } from './payment.entities';

const FILTER_OFF = { filters: { company: false } } as const;

export interface PayableHandoff {
  documentId: string;
  docNo: string;
  vendorId?: string;
  vendorName?: string;
  baseAmount: string;
  glAccounts: string[];
}

/**
 * The ready-to-pay queue: settled disbursements (COMPLETED documents whose type
 * `post_action` is CUT_BUDGET) for an external accounting system to pull. Derived, not
 * stored, and company-scoped. The payable amount is the disbursement's settled base total.
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
      { populate: ['documentType', 'vendor'] },
    );
    const cutBudget = completed.filter((d) => d.documentType.postAction === 'CUT_BUDGET');
    if (cutBudget.length === 0) return [];

    // Exclude disbursements already recorded as paid — the queue is what's still owed.
    const paid = await this.em
      .fork()
      .find(Payment, { document: { $in: cutBudget.map((d) => d.id) } }, FILTER_OFF);
    const paidIds = new Set(paid.map((p) => p.document.id));
    const payables = cutBudget.filter((d) => !paidIds.has(d.id));
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
      baseAmount: d.baseTotalAmount ?? '0',
      glAccounts: [...(glByDoc.get(d.id) ?? [])],
    }));
  }
}

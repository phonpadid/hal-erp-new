import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Money } from '../../common/money/money';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Document, DocumentLine, DocumentType } from './document.entities';

const FILTER_OFF = { filters: { company: false } } as const;

// Amount tolerance for 3-way matching. Default exact (no over-billing); configurable later.
const AMOUNT_TOLERANCE = '0';

export interface MatchLine {
  lineNo: number;
  orderedQty: string;
  receivedQty: string;
  invoicedQty: string;
  orderedAmount: string;
  invoicedAmount: string;
  pass: boolean;
  reason?: string;
}

export interface MatchResult {
  ok: boolean;
  lines: MatchLine[];
}

/**
 * 3-way matching: a disbursement document (references a PO) is matched per line against the
 * PO — invoiced qty must not exceed the PO line's received_qty, and invoiced amount must not
 * exceed the ordered amount within tolerance.
 */
@Injectable()
export class MatchingService {
  constructor(
    private readonly em: EntityManager,
    private readonly scope: CompanyScopeService,
  ) {}

  async match(disbursementId: string): Promise<MatchResult> {
    const scoped = this.scope.forActiveCompany();
    const disbursement = await scoped.findOne(Document, { id: disbursementId }, { populate: ['refDocument'] });
    if (!disbursement) throw new NotFoundException(`Document ${disbursementId} not found`);
    if (!disbursement.refDocument) return { ok: true, lines: [] }; // not a PO-referencing disbursement
    // Only a disbursement (post_action CUT_BUDGET) is 3-way matched against its PO — mirrors the
    // submit-time gate. A non-disbursement with a predecessor (e.g. a PO referencing a PROC) is
    // NOT a match candidate: matching it would treat the PO's ordered qty as "invoiced" against
    // the PROC's zero received qty and spuriously fail. Resolve the type by id (populate can yield
    // an unloaded stub with an undefined post_action).
    const docType = await scoped.findOne(DocumentType, { id: disbursement.documentType.id });
    if (docType?.postAction !== 'CUT_BUDGET') return { ok: true, lines: [] };

    const em = this.em.fork();
    const poLines = await em.find(DocumentLine, { document: disbursement.refDocument.id }, FILTER_OFF);
    const poByLineNo = new Map(poLines.map((l) => [l.lineNo, l]));
    const invoiceLines = await em.find(DocumentLine, { document: disbursementId }, { ...FILTER_OFF, orderBy: { lineNo: 'ASC' } });

    const lines: MatchLine[] = invoiceLines.map((inv) => {
      const po = poByLineNo.get(inv.lineNo);
      if (!po) {
        return {
          lineNo: inv.lineNo,
          orderedQty: '0', receivedQty: '0', invoicedQty: inv.qty,
          orderedAmount: '0', invoicedAmount: inv.lineAmount,
          pass: false, reason: 'No matching PO line',
        };
      }
      const overReceived = Money.compare(inv.qty, po.receivedQty) > 0;
      const orderedWithTolerance = Money.multiply(po.lineAmount, Money.add('1', AMOUNT_TOLERANCE));
      const overBilled = Money.compare(inv.lineAmount, orderedWithTolerance) > 0;
      const pass = !overReceived && !overBilled;
      const reason = overReceived
        ? `Invoiced qty ${inv.qty} exceeds received ${po.receivedQty}`
        : overBilled
          ? `Invoiced amount ${inv.lineAmount} exceeds ordered ${po.lineAmount}`
          : undefined;
      return {
        lineNo: inv.lineNo,
        orderedQty: po.qty, receivedQty: po.receivedQty, invoicedQty: inv.qty,
        orderedAmount: po.lineAmount, invoicedAmount: inv.lineAmount,
        pass, reason,
      };
    });

    return { ok: lines.every((l) => l.pass), lines };
  }

  /** Throw a per-line BadRequest when matching fails (used to gate submit). */
  async assertMatched(disbursementId: string): Promise<void> {
    const result = await this.match(disbursementId);
    if (!result.ok) {
      const failed = result.lines.filter((l) => !l.pass).map((l) => `line ${l.lineNo}: ${l.reason}`);
      throw new BadRequestException(`3-way matching failed — ${failed.join('; ')}`);
    }
  }
}

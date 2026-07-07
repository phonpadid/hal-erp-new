import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContext } from '../../common/context/request-context';
import { DocStatus } from '../../common/enums';
import { Money } from '../../common/money/money';
import { inTransaction } from '../../common/uow/unit-of-work';
import { Company } from '../multi-company/multi-company.entities';
import { Document } from '../document/document.entities';
import { AppUser } from '../rbac/rbac.entities';
import { TaxKind } from '../../common/enums';
import { TaxService } from '../tax/tax.service';
import { TaxCode } from '../tax/tax.entities';
import { Payment } from './payment.entities';

const FILTER_OFF = { filters: { company: false } } as const;

export interface PaymentResult {
  documentId: string;
  lockedRate: string;
  actualRate: string;
  baseLocked: string;
  baseActual: string;
  fxDelta: string;
  fxKind: string;
  whtAmount: string;
}

/**
 * Records the actual payment of a settled disbursement at its real rate and computes the FX
 * gain/loss vs the locked rate. The delta is persisted on a `payment` record and emitted as
 * `payment.settled` for external accounting — it MUST NOT touch the budget (invariant 6).
 */
@Injectable()
export class PaymentService {
  constructor(
    private readonly em: EntityManager,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  async record(documentId: string, actualRate: string, whtTaxCodeId?: string): Promise<PaymentResult> {
    const companyId = RequestContext.companyId()!;
    const userId = RequestContext.userId();
    if (Money.compare(actualRate, '0') <= 0) throw new BadRequestException('actualRate must be positive');

    const result = await inTransaction(this.em, async (tem) => {
      const doc = await tem.findOne(Document, { id: documentId }, { ...FILTER_OFF, populate: ['documentType', 'company'] });
      if (!doc || doc.company.id !== companyId) throw new NotFoundException(`Document ${documentId} not found`);
      if (doc.status !== DocStatus.COMPLETED || doc.documentType.postAction !== 'CUT_BUDGET') {
        throw new BadRequestException('Document is not a settled disbursement');
      }
      if (await tem.findOne(Payment, { document: documentId }, FILTER_OFF)) {
        throw new BadRequestException('Document already has a recorded payment');
      }

      const company = await tem.findOne(Company, { id: companyId }, { ...FILTER_OFF, populate: ['baseCurrency'] });
      const dp = company?.baseCurrency?.decimalPlaces ?? 2;
      const lockedRate = doc.exchangeRate ?? '1';
      const baseLocked = doc.baseTotalAmount ?? '0';
      // Re-rate the locked base to the actual rate: base_actual = base_locked × actual/locked.
      // Derive from base_locked (always stamped) rather than doc.total_amount, which is null for
      // line-based documents — using it produced a base_actual of 0 and a phantom full-amount FX.
      const baseActual = Money.round(Money.divide(Money.multiply(baseLocked, actualRate), lockedRate), dp);
      const fxDelta = Money.subtract(baseActual, baseLocked);
      const cmp = Money.compare(fxDelta, '0');
      const fxKind = cmp > 0 ? 'LOSS' : cmp < 0 ? 'GAIN' : 'NONE';

      // WHT: withhold on the pre-VAT net base (base_locked − base_tax_total); pay the vendor net.
      let whtAmount = '0';
      let whtCode: TaxCode | null = null;
      if (whtTaxCodeId) {
        whtCode = await tem.findOne(TaxCode, { id: whtTaxCodeId, company: companyId }, FILTER_OFF);
        if (!whtCode) throw new BadRequestException(`Tax code ${whtTaxCodeId} not found`);
        if (!whtCode.isActive) throw new BadRequestException(`Tax code '${whtCode.code}' is inactive`);
        if (whtCode.kind !== TaxKind.WHT) throw new BadRequestException(`Tax code '${whtCode.code}' is not a WHT code`);
        const netBase = Money.subtract(baseLocked, doc.baseTaxTotal ?? '0');
        whtAmount = TaxService.computeWht(netBase, whtCode.rate, dp);
      }

      tem.persist(
        tem.create(Payment, {
          company: tem.getReference(Company, companyId),
          document: tem.getReference(Document, documentId),
          lockedRate,
          actualRate,
          baseLocked,
          baseActual,
          fxDelta,
          fxKind,
          whtAmount,
          whtTaxCode: whtCode ? tem.getReference(TaxCode, whtCode.id) : undefined,
          createdBy: userId ? tem.getReference(AppUser, userId) : undefined,
          paidAt: new Date(),
          createdAt: new Date(),
        }),
      );
      await tem.flush();
      return { documentId, lockedRate, actualRate, baseLocked, baseActual, fxDelta, fxKind, whtAmount };
    });

    // After commit: hand the FX breakdown to accounting.
    this.events?.emit('payment.settled', result);
    return result;
  }
}

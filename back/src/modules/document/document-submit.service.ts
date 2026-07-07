import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { isFieldVisible, isLevelGated } from '@erp/shared';
import { RequestContext } from '../../common/context/request-context';
import { WorkflowStep } from '../approval/approval.entities';
import { Employee } from '../rbac/rbac.entities';
import { DocStatus } from '../../common/enums';
import { Money } from '../../common/money/money';
import { inTransaction } from '../../common/uow/unit-of-work';
import { BudgetLedgerService, type ReserveLine } from '../budget/budget-ledger.service';
import { Currency } from '../currency/currency.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { ItemService } from '../master-data/item.service';
import { MatchingService } from './matching.service';
import { TaxService } from '../tax/tax.service';
import { VendorService } from '../master-data/vendor.service';
import { Company } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import {
  DocFieldValue,
  Document,
  DocumentLine,
  DocumentType,
  FormField,
} from './document.entities';
import type { SubmitDocumentDto } from './dto/document.dto';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Submit: the integration point. In one transaction — validate required fields, lock
 * FX + base amounts, guard the fiscal period and vendor/item enablement, then (driven by
 * document_type flags) reserve budget per line and quota. Cancel/reject release holds.
 */
@Injectable()
export class DocumentSubmitService {
  constructor(
    private readonly em: EntityManager,
    private readonly exchangeRates: ExchangeRateService,
    private readonly fiscalYears: FiscalYearService,
    private readonly vendors: VendorService,
    private readonly items: ItemService,
    private readonly budget: BudgetLedgerService,
    private readonly quota: QuotaUsageService,
    // Optional: present in the running app; absent in unit tests that don't exercise matching.
    @Optional() private readonly matching?: MatchingService,
    // Optional: present in the running app (EventEmitterModule), absent in unit tests.
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  async submit(documentId: string, dto: SubmitDocumentDto = {}): Promise<Document> {
    const companyId = RequestContext.companyId()!;
    const read = this.em.fork();

    const document = await read.findOne(Document, { id: documentId }, FILTER_OFF);
    if (!document) throw new NotFoundException(`Document ${documentId} not found`);
    if (document.status !== DocStatus.DRAFT) {
      throw new BadRequestException(`Document ${documentId} is not in DRAFT`);
    }

    // Load the type flags + company base currency explicitly (robust vs. populate).
    const docType = await read.findOneOrFail(DocumentType, { id: document.documentType.id });

    // Config-driven vendor requirement (invariant 7): a type that requires a vendor cannot
    // submit without one. A draft may be saved incomplete; submit is where completeness is
    // enforced, mirroring the required-field gate below.
    if (docType.requiresVendor && !document.vendor) {
      throw new BadRequestException('A vendor is required for this document type');
    }

    // 3-way matching gate: a disbursement (CUT_BUDGET) that references a PO must match
    // (invoiced ≤ received ≤ ordered) before it can be submitted (invariant: no pay before receipt).
    if (docType.postAction === 'CUT_BUDGET' && document.refDocument && this.matching) {
      await this.matching.assertMatched(documentId);
    }
    // Level-gate guard (approval-workflow: no silent step-skip). When the bound workflow has any
    // step restricted by requester position level (workflow_step.condition_json jobLevels), the
    // requester MUST have an employee.job_level. Otherwise those steps would be silently skipped at
    // routing, shortening the approval chain. Enforced here — before any hold is created — so a
    // rejected submit leaves the document DRAFT with no budget/quota reserved.
    const steps = await read.find(WorkflowStep, { workflow: document.workflow.id }, FILTER_OFF);
    if (isLevelGated(steps)) {
      const requester = await read.findOne(
        Employee,
        { user: document.createdBy.id, company: document.company.id },
        FILTER_OFF,
      );
      if (!requester?.jobLevel) {
        throw new BadRequestException(
          'This workflow has position-level approval steps; set the requester’s job level (employee.job_level) before submitting',
        );
      }
    }

    const company = await read.findOne(
      Company,
      { id: document.company.id },
      { populate: ['baseCurrency'] },
    );

    // 1. Required-field validation — only for fields that are VISIBLE under their
    // condition_json. A hidden field is neither required nor persisted. The same shared
    // evaluator runs on the client, so display and enforcement cannot drift.
    const fields = await read.find(
      FormField,
      { formTemplate: document.formTemplate.id },
      { orderBy: { sortOrder: 'ASC' }, ...FILTER_OFF },
    );
    const values = await read.find(DocFieldValue, { document: documentId }, FILTER_OFF);
    const valueByFieldId = new Map(values.map((v) => [v.formField.id, v.fieldValue]));
    const valuesByName: Record<string, string | undefined> = {};
    for (const f of fields) valuesByName[f.fieldName] = valueByFieldId.get(f.id) ?? undefined;

    const hiddenFieldIds: string[] = [];
    for (const f of fields) {
      const visible = isFieldVisible(f.conditionJson, valuesByName);
      if (!visible) {
        hiddenFieldIds.push(f.id);
        continue;
      }
      if (f.isRequired) {
        const val = valueByFieldId.get(f.id);
        if (val === undefined || val === null || val === '') {
          throw new BadRequestException(`Required field '${f.fieldName}' is missing`);
        }
      }
    }

    // 2. Amounts + locked FX.
    const lines = await read.find(DocumentLine, { document: documentId }, { ...FILTER_OFF, populate: ['taxCode'] });
    const total = lines.length
      ? lines.reduce((s, l) => Money.add(s, l.lineAmount), '0')
      : document.totalAmount ?? '0';
    const baseCode = company?.baseCurrency?.code ?? 'THB';
    const docCode = document.currency?.code ?? baseCode;
    const asOf = new Date().toISOString().slice(0, 10);
    const { rate } = await this.exchangeRates.resolveRate({ from: docCode, to: baseCode, asOf, companyId });
    const dp = (await read.findOne(Currency, { code: baseCode }))?.decimalPlaces ?? 2;
    const toBase = (amount: string) => Money.round(Money.multiply(amount, rate), dp);

    // Purchase VAT (per line, document currency). Input VAT does NOT change the budget basis
    // (invariant 3) — it rides the payment/FX total only. Summing rounded per-line amounts keeps
    // the lines reconciled to the document tax total (no drift).
    const docDp = (await read.findOne(Currency, { code: docCode }))?.decimalPlaces ?? dp;
    const lineTax = new Map<string, string>();
    let taxTotal = '0';
    for (const l of lines) {
      const t = l.taxCode ? TaxService.computeLineVat(l.lineAmount, l.taxCode.rate, docDp) : '0';
      lineTax.set(l.id, t);
      taxTotal = Money.add(taxTotal, t);
    }
    const subTotal = total;
    const grandTotal = Money.add(subTotal, taxTotal);

    // Budget basis at the fixed BUDGET_RATE so daily FX doesn't whipsaw budget control / approval
    // thresholds; fall back to the daily rate when no BUDGET_RATE is configured for the pair.
    let budgetRate = rate;
    try {
      budgetRate = (await this.exchangeRates.resolveRate({ from: docCode, to: baseCode, asOf, companyId, rateType: 'BUDGET_RATE' })).rate;
    } catch {
      budgetRate = rate; // no BUDGET_RATE → budget base equals the daily base
    }
    const budgetToBase = (amount: string) => Money.round(Money.multiply(amount, budgetRate), dp);

    // 3. Period guard (budget posts into a fiscal year).
    if (docType.requiresBudget) {
      await this.fiscalYears.assertOpenPeriod(asOf, companyId);
    }

    // 4. Enablement guards.
    if (document.vendor) await this.vendors.assertVendorEnabled(document.vendor.id, companyId);
    for (const l of lines) {
      if (l.item) await this.items.assertItemEnabled(l.item.id, companyId);
    }

    // 5. Config-driven holds (invariant 7) — build before opening the write txn.
    // Reserve at the BUDGET_RATE basis (what the budget is planned in).
    const reserveLines: ReserveLine[] = lines
      .filter((l) => l.budget)
      .map((l) => ({ budgetId: l.budget!.id, baseAmount: budgetToBase(l.lineAmount) }));
    if (docType.requiresBudget && reserveLines.length === 0) {
      throw new BadRequestException('Budget-controlled document has no budgeted lines');
    }
    if (docType.requiresQuota && !dto.quotaReservations?.length) {
      throw new BadRequestException('Quota-controlled document declares no quota reservations');
    }

    await inTransaction(this.em, async (tem) => {
      if (docType.requiresBudget) {
        await this.budget.reserve(documentId, reserveLines, tem);
      }
      if (docType.requiresQuota) {
        for (const q of dto.quotaReservations!) {
          await this.quota.reserve(
            { documentId, quotaId: q.quotaId, employeeId: q.employeeId, qty: q.qty, year: q.year },
            tem,
          );
        }
      }

      // Drop values whose field is hidden under its condition — they must not persist.
      if (hiddenFieldIds.length) {
        await tem.nativeDelete(DocFieldValue, {
          document: documentId,
          formField: { $in: hiddenFieldIds },
        });
      }

      // Stamp locked FX + base amounts and transition status — same transaction.
      const doc = await tem.findOne(Document, { id: documentId }, FILTER_OFF);
      doc!.exchangeRate = rate;
      // base_total_amount is the tax-inclusive grand total (payment/FX basis); the budget basis
      // stays pre-tax (net). base_tax_total is the input VAT in base currency for the GL.
      doc!.baseTotalAmount = toBase(grandTotal);
      doc!.budgetExchangeRate = budgetRate;
      doc!.budgetBaseTotalAmount = budgetToBase(total);
      doc!.subTotal = subTotal;
      doc!.taxTotal = taxTotal;
      doc!.grandTotal = grandTotal;
      doc!.baseTaxTotal = toBase(taxTotal);
      doc!.status = DocStatus.SUBMITTED;
      doc!.submittedAt = new Date();
      const txLines = await tem.find(DocumentLine, { document: documentId }, FILTER_OFF);
      for (const l of txLines) {
        l.taxAmount = lineTax.get(l.id) ?? '0';
        l.baseLineAmount = toBase(l.lineAmount);
        l.budgetBaseLineAmount = budgetToBase(l.lineAmount);
      }
      await tem.flush();
    });

    // After commit: let approval-workflow auto-start routing (decoupled via the event).
    this.events?.emit('document.submitted', { documentId });

    return read.findOneOrFail(Document, { id: documentId }, { refresh: true, ...FILTER_OFF });
  }

  /**
   * Cancel = the requester withdraws their own pending request, releasing its budget +
   * quota holds (invariant 4). Only the creator may cancel, and only before the document
   * is finalized: DRAFT / SUBMITTED / IN_APPROVAL. Once APPROVED/COMPLETED its budget is
   * actualized and once REJECTED it is already terminal, so those must not be cancelled —
   * an approver who wants to stop an in-flight document uses reject/return instead.
   */
  async cancel(documentId: string): Promise<void> {
    const userId = RequestContext.userId();
    const em = this.em.fork();
    const doc = await em.findOne(Document, { id: documentId }, FILTER_OFF);
    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);
    if (doc.status === DocStatus.CANCELLED) return;
    if (doc.createdBy.id !== userId) {
      throw new ForbiddenException('Only the document creator can cancel it');
    }
    const CANCELLABLE = [DocStatus.DRAFT, DocStatus.SUBMITTED, DocStatus.IN_APPROVAL];
    if (!CANCELLABLE.includes(doc.status)) {
      throw new BadRequestException(`A ${doc.status} document cannot be cancelled`);
    }
    doc.status = DocStatus.CANCELLED;
    await em.flush();
    await this.releaseDocumentHolds(documentId);
  }

  /** Release all of a document's budget + quota holds (shared with approval reject). */
  async releaseDocumentHolds(documentId: string): Promise<void> {
    await inTransaction(this.em, async (tem) => {
      await this.budget.releaseAll(documentId, tem);
      await this.quota.releaseAll(documentId, tem);
    });
  }
}

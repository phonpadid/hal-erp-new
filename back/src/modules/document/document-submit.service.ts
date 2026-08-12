import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { isFieldVisible, isLevelGated } from '@erp/shared';
import { RequestContext } from '../../common/context/request-context';
import { WorkflowStep } from '../approval/approval.entities';
import { Employee } from '../rbac/rbac.entities';
import { VendorBankAccount } from '../master-data/master-data.entities';
import { DocStatus } from '../../common/enums';
import { Money } from '../../common/money/money';
import { coded, ErrorCode } from '../../common/errors/error-code';
import { inTransaction } from '../../common/uow/unit-of-work';
import { BudgetLedgerService, type ReserveLine } from '../budget/budget-ledger.service';
import { BudgetPlanService } from '../budget/budget-plan.service';
import { Currency } from '../currency/currency.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { ItemService } from '../master-data/item.service';
import { StockMovementService, type StockDemand } from '../inventory/stock-movement.service';
import { WarehouseService } from '../inventory/warehouse.service';
import { MatchingService } from './matching.service';
import { TaxService } from '../tax/tax.service';
import { VendorService } from '../master-data/vendor.service';
import { Company } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import type { QuotaOvershoot } from '../quota/quota-usage.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import { QuotaEntitlement } from '../quota/quota.entities';
import {
  DocFieldValue,
  Document,
  DocumentAttachment,
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
  private readonly logger = new Logger(DocumentSubmitService.name);

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
    // Optional for the same reason: a unit test that submits a non-stock document needs neither.
    @Optional() private readonly stock?: StockMovementService,
    @Optional() private readonly warehouses?: WarehouseService,
    // Optional: present in the running app (EventEmitterModule), absent in unit tests.
    @Optional() private readonly events?: EventEmitter2,
    // Optional for the same reason as the others: only a rejected budget plan reaches it.
    @Optional() private readonly plans?: BudgetPlanService,
  ) {}

  /**
   * `opts.quantityAlreadyDerived` is for the capability that OWNS a `derives_quantity` type and
   * has just computed the quantity itself. Named for the claim it makes rather than as a generic
   * "skip the check", so a call site that sets it without having derived anything reads as wrong.
   */
  async submit(
    documentId: string,
    dto: SubmitDocumentDto = {},
    opts: { quantityAlreadyDerived?: boolean } = {},
  ): Promise<Document> {
    const companyId = RequestContext.companyId()!;
    const read = this.em.fork();

    const document = await read.findOne(Document, { id: documentId }, FILTER_OFF);
    if (!document) throw new NotFoundException(`Document ${documentId} not found`);
    if (document.status !== DocStatus.DRAFT) {
      // Coded: an integration that resubmits a document already on its way needs to skip, not
      // retry, and telling that apart from a refused budget is the whole point of the code.
      throw coded(ErrorCode.INVALID_STATE, `Document ${documentId} is not in DRAFT`);
    }

    // Load the type flags + company base currency explicitly (robust vs. populate).
    const docType = await read.findOneOrFail(DocumentType, { id: document.documentType.id });

    // A type whose quantity the system derives cannot be submitted here: the caller would have to
    // state a figure, and the whole point is that the figure is not theirs to state. Declines from
    // configuration on document-engine's OWN table — the capability that can compute the quantity
    // is built after this one and must not be imported. Runs first, before any gate that could
    // reserve or lock anything.
    if (docType.derivesQuantity && !opts.quantityAlreadyDerived) {
      throw new BadRequestException(
        `Documents of type '${docType.code}' have a system-computed quantity and cannot be ` +
          `submitted through the generic endpoint; submit them through the capability that owns ` +
          `the type (for leave: POST /leave-requests/:documentId/submit)`,
      );
    }

    // Config-driven vendor requirement (invariant 7): a type that requires a vendor cannot
    // submit without one. A draft may be saved incomplete; submit is where completeness is
    // enforced, mirroring the required-field gate below.
    if (docType.requiresVendor && !document.vendor) {
      throw new BadRequestException('A vendor is required for this document type');
    }

    // Config-driven payee requirement (invariant 7): a type that requires a payee cannot submit
    // without an active bank account of its OWN vendor. Binding the payee to the document is what
    // carries it through the approval chain — the approvers who approve the amount also approve
    // where the money lands, and no later actor can redirect an approved payment.
    //
    // Branches on requires_payee, never on post_action: the seeded PR carries CUT_BUDGET too (so it
    // can settle its own reservation), but nobody knows the payee when raising a requisition, so
    // inferring from CUT_BUDGET would block every PR submit.
    //
    // Sits here, before any budget or quota hold, so a rejected submit leaves the document DRAFT
    // with nothing reserved.
    if (docType.requiresPayee) {
      const payee = document.vendorBankAccount
        ? await read.findOne(VendorBankAccount, { id: document.vendorBankAccount.id }, { populate: ['vendor'] })
        : null;
      if (!payee) {
        throw new BadRequestException('A payee bank account is required for this document type');
      }
      if (!document.vendor || payee.vendor.id !== document.vendor.id) {
        throw new BadRequestException("The payee bank account does not belong to this document's vendor");
      }
      if (!payee.isActive) {
        throw new BadRequestException('The payee bank account is no longer active');
      }
    }

    // Config-driven warehouse requirement (invariant 7). Like the vendor and payee gates it runs
    // before any hold is taken, so a rejected submit leaves the document DRAFT with nothing
    // reserved. `requireActive` rejects a warehouse of another company (invariant 1) and a
    // deactivated one, so neither can be the silent destination of a movement.
    let stockWarehouseId: string | undefined;
    let stockDestWarehouseId: string | undefined;
    if (docType.requiresWarehouse) {
      if (!document.warehouse) {
        throw new BadRequestException('A warehouse is required for this document type');
      }
      stockWarehouseId = (await this.warehouses!.requireActive(document.warehouse.id)).id;

      // A transfer needs somewhere to go, and the two ends must differ — a transfer to itself
      // would write a paired OUT/IN that nets to nothing while looking like a real movement.
      if (docType.postAction === 'TRANSFER_STOCK') {
        if (!document.destWarehouse) {
          throw new BadRequestException('A destination warehouse is required for a stock transfer');
        }
        stockDestWarehouseId = (await this.warehouses!.requireActive(document.destWarehouse.id)).id;
        if (stockDestWarehouseId === stockWarehouseId) {
          throw new BadRequestException('A transfer must name two different warehouses');
        }
      }
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

    // `file` and `line_items` fields don't store their content in doc_field_value — a file
    // lives in document_attachment, a line in document_line. So a required field of those
    // types is "present" when at least one such row exists, mirroring the client's hasValue.
    const attachmentCount = await read.count(DocumentAttachment, { document: documentId }, FILTER_OFF);
    const lineCount = await read.count(DocumentLine, { document: documentId }, FILTER_OFF);

    const hiddenFieldIds: string[] = [];
    for (const f of fields) {
      const visible = isFieldVisible(f.conditionJson, valuesByName);
      if (!visible) {
        hiddenFieldIds.push(f.id);
        continue;
      }
      if (f.isRequired) {
        const val = valueByFieldId.get(f.id);
        const present =
          f.fieldType === 'file'
            ? attachmentCount > 0
            : f.fieldType === 'line_items'
              ? lineCount > 0
              : val !== undefined && val !== null && val !== '';
        if (!present) {
          throw new BadRequestException(`Required field '${f.fieldName}' is missing`);
        }
      }
    }

    // 2. Amounts + locked FX.
    const lines = await read.find(DocumentLine, { document: documentId }, { ...FILTER_OFF, populate: ['taxCode', 'budget'] });
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

    // A claim for input VAT has to be able to name the tax invoice it is claiming against — but
    // only on the document that actually claims it.
    //
    // `accrues_on_approval` is that set, and it is not a second rule: it is exactly the documents
    // whose accrual posts VAT_INPUT and is dated by the invoice. A requisition may carry a tax code
    // to estimate what a purchase will cost, and nobody has the supplier's invoice when raising one
    // — the seeded chain says as much, that the disbursement IS the accepted invoice while a PR and
    // a PO are commitments. Demanding the number wherever tax appears would block every estimate.
    //
    // Still before any hold, so a rejected submit leaves the document DRAFT with nothing reserved.
    if (docType.accruesOnApproval && Money.compare(taxTotal, '0') > 0) {
      if (!document.vendorInvoiceNo?.trim()) {
        throw new BadRequestException(
          'A supplier invoice number is required for a document claiming input VAT',
        );
      }
      if (!document.vendorInvoiceDate) {
        throw new BadRequestException(
          'A supplier invoice date is required for a document claiming input VAT',
        );
      }
    }

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

    // 4. Enablement guards. Re-validate each line's resolved budget at submit: a budget can be
    // deactivated between draft and submit, so a stored budget_id is not trusted blindly
    // (design: re-resolve/re-validate at submit). An inactive budget is rejected before any
    // hold is taken, leaving the document DRAFT.
    if (document.vendor) await this.vendors.assertVendorEnabled(document.vendor.id, companyId);
    for (const l of lines) {
      if (l.item) await this.items.assertItemEnabled(l.item.id, companyId);
      if (l.budget && l.budget.status !== 'ACTIVE') {
        throw new BadRequestException(
          `Line ${l.lineNo} charges an inactive budget (GL ${l.glAccount ?? '—'}); re-select a budget before submitting`,
        );
      }
    }

    // Config-driven completeness (invariant 7), enforced at submit like the vendor gate so a
    // draft may be incomplete. Item-mandatory types forbid free-text lines.
    if (docType.requiresItem) {
      const itemless = lines.find((l) => !l.item);
      if (itemless) {
        throw new BadRequestException(
          `Line ${itemless.lineNo} has no item; this document type requires an item on every line`,
        );
      }
    }

    // 5. Config-driven holds (invariant 7) — build before opening the write txn.
    // Reserve at the BUDGET_RATE basis (what the budget is planned in).
    const reserveLines: ReserveLine[] = lines
      .filter((l) => l.budget)
      .map((l) => ({ budgetId: l.budget!.id, baseAmount: budgetToBase(l.lineAmount) }));
    // Complete budget coverage: every money-bearing line MUST resolve a budget, else it would
    // reserve nothing and commit money without cutting budget. A zero-amount line reserves
    // nothing and is allowed budget-less. This strengthens the old "has any budgeted line"
    // check (kept below so an all-zero/empty budget document still can't reserve nothing).
    if (docType.requiresBudget) {
      const uncovered = lines.find((l) => Money.compare(l.lineAmount, '0') > 0 && !l.budget);
      if (uncovered) {
        throw new BadRequestException(
          `Line ${uncovered.lineNo} has a positive amount but no budget; every line of a budget-controlled document must charge a budget`,
        );
      }
      if (reserveLines.length === 0) {
        throw new BadRequestException('Budget-controlled document has no budgeted lines');
      }
    }
    if (docType.requiresQuota && !dto.quotaReservations?.length) {
      throw new BadRequestException('Quota-controlled document declares no quota reservations');
    }

    // Stock hold (invariant 4), driven by post_action rather than a hardcoded type code
    // (invariant 7). ADJUST_STOCK does not reserve: an adjustment corrects what is already on the
    // shelf, so there is nothing to hold and a decrease is checked when it is applied.
    const RESERVING_ACTIONS = ['ISSUE_STOCK', 'TRANSFER_STOCK'];
    const reservesStock = !!docType.postAction && RESERVING_ACTIONS.includes(docType.postAction);

    await inTransaction(this.em, async (tem) => {
      if (docType.requiresBudget) {
        // One hold per ref chain: a successor copies its predecessor's budgeted lines, and only the
        // holder's reservation is ever settled, so reserving a budget an ancestor is still holding
        // would strand that second RESERVE forever. Runs inside this transaction and takes the
        // budget locks itself, so a concurrent settle can't slip between the check and the insert.
        const held = await this.budget.budgetsHeldByAncestors(
          documentId,
          [...new Set(reserveLines.map((l) => l.budgetId))],
          tem,
        );
        const fresh = reserveLines.filter((l) => !held.has(l.budgetId));
        if (fresh.length) await this.budget.reserve(documentId, fresh, tem);
      }
      if (reservesStock) {
        // Availability is enforced HERE, at submit, not at approval: a shortage is the
        // requester's to fix, and holding it now makes the reservation real for everyone queued
        // behind them. A shortfall throws, rolling back this whole transaction, so the document
        // stays DRAFT with no budget or quota reserved either.
        const demand = await this.stock!.demandFor(tem, document, stockWarehouseId!);
        await this.stock!.reserve(tem, demand);
      }
      if (docType.requiresQuota) {
        // Beneficiary resolution. A personal (entitlement-scoped) quota is charged to the
        // document's `related_employee_id` when it carries one, and otherwise to the submitter's
        // OWN employee. A client-supplied employee id is ignored in BOTH cases — that is the
        // protection this block exists for, and it is unchanged.
        //
        // `related_employee_id` is safe to trust where the request body is not: it is a column on
        // the document, set at creation, and it travels the same approval steps as the amount, so
        // whoever approves the leave can see whose leave it is. It is what makes HR filing on
        // behalf of staff with no login account charge THAT person rather than HR.
        // Overshoots on SOFT_WARNING quotas are collected here rather than thrown. See the note
        // at the end of this block on how far they currently travel.
        const overshoots: QuotaOvershoot[] = [];
        const quotaIds = [...new Set(dto.quotaReservations!.map((q) => q.quotaId))];
        const ents = await tem.find(QuotaEntitlement, { quota: { $in: quotaIds } }, FILTER_OFF);
        const personal = new Set(ents.map((e) => e.quota.id));
        let beneficiaryId: string | undefined;
        if (personal.size) {
          const relatedId = document.relatedEmployee?.id;
          if (relatedId) {
            const related = await tem.findOne(
              Employee,
              { id: relatedId, company: document.company.id },
              FILTER_OFF,
            );
            if (!related) {
              throw new BadRequestException(
                'The related employee on this document does not belong to its company',
              );
            }
            beneficiaryId = related.id;
          } else {
            const requester = await tem.findOne(
              Employee,
              { user: document.createdBy.id, company: document.company.id },
              FILTER_OFF,
            );
            if (!requester) {
              throw new BadRequestException(
                'This document reserves a personal quota, but the requester has no linked employee to charge it to',
              );
            }
            beneficiaryId = requester.id;
          }
        }
        for (const q of dto.quotaReservations!) {
          const employeeId = personal.has(q.quotaId) ? beneficiaryId : undefined;
          await this.quota.reserve(
            { documentId, quotaId: q.quotaId, employeeId, qty: q.qty, year: q.year, overshoots },
            tem,
          );
        }
        // NOTE: these stop here for now. `submit` returns the Document, and budget's own
        // SOFT_WARNING warnings are discarded at the same point (see the ignored return of
        // `budget.reserve` above) — so propagating quota's alone would make the two inconsistent.
        // Carrying either to the caller is a change to submit's contract, which 40 specs depend on.
        if (overshoots.length) {
          this.logger.warn(
            `Document ${documentId} submitted over quota: ` +
              overshoots.map((o) => `${o.quotaType} by ${o.overBy}`).join(', '),
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
      throw coded(
        ErrorCode.INVALID_STATE,
        `A ${doc.status} document cannot be cancelled`,
      );
    }
    doc.status = DocStatus.CANCELLED;
    await em.flush();
    await this.releaseDocumentHolds(documentId);
  }

  /**
   * Release all of a document's budget + quota + stock holds (shared with approval reject).
   *
   * Reject/cancel ALWAYS releases every kind of hold (invariant 5), and each release is
   * idempotent, so calling this twice is a no-op rather than a double credit.
   */
  async releaseDocumentHolds(documentId: string): Promise<void> {
    await inTransaction(this.em, async (tem) => {
      await this.budget.releaseAll(documentId, tem);
      await this.quota.releaseAll(documentId, tem);
      if (this.stock) await this.stock.release(tem, documentId);
      // A budget plan holds nothing to release — its type has requires_budget false, so the three
      // calls above are all no-ops for it — but its DRAFT budgets must not stay DRAFT forever.
      // Marking them REJECTED here is what frees their (fiscal year, department, gl_account) slot,
      // so a line that was turned down can be proposed again. Idempotent, like every release above.
      if (this.plans) await this.plans.markRejected(documentId, tem);
    });
  }
}

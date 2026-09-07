import { EntityManager } from '@mikro-orm/postgresql';
import { TRANSFER_SOURCES, type TransferSource } from '@erp/shared';
import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContext } from '../../common/context/request-context';
import { DocStatus } from '../../common/enums';
import { Money } from '../../common/money/money';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { StorageService } from '../../common/storage/storage.service';
import {
  EVIDENCE_MIME_ALLOWLIST,
  validateUpload,
  type UploadedFile,
} from '../../common/storage/upload';
import { inTransaction } from '../../common/uow/unit-of-work';
import { Company } from '../multi-company/multi-company.entities';
import { Document } from '../document/document.entities';
import { AppUser } from '../rbac/rbac.entities';
import { TaxKind } from '../../common/enums';
import { TaxService } from '../tax/tax.service';
import { TaxCode } from '../tax/tax.entities';
import { owedDocuments } from './owed';
import { SLIP_MAX_SIZE_KB } from './payment-attachment.service';
import { PAYMENT_METHODS, Payment, PaymentAttachment, PaymentBatch } from './payment.entities';

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
  /**
   * Which of the company's accounts the transfer left, as the person recording it stated. Absent
   * for cash, which left no bank account. Returned so the screen that just recorded the payment
   * reads back what was stored rather than what it thinks it sent.
   */
  transferFrom?: TransferSource;
}

/** What one recorded payment states beyond its rate. */
export interface RecordPaymentInput {
  /**
   * The rate the money actually converted at. Optional here because the transfer slip normally
   * states it — see `record`, which adopts the slip's when the request carries none.
   */
  actualRate?: string;
  whtTaxCodeId?: string;
  method?: string;
  /** Which of the company's accounts a transfer left. Required for a transfer, refused for cash. */
  transferFrom?: TransferSource;
  reference?: string;
  note?: string;
  /**
   * Evidence that the money moved. Required unless a batch produced this payment — see `batch`.
   * Supplied WITH the record rather than uploaded afterwards, so a payment nobody is obliged to
   * justify cannot exist even briefly.
   */
  file?: UploadedFile;
  /**
   * The run this payment came out of, when a batch result import is recording it. Its presence is
   * what makes evidence unnecessary: the file sent to the bank and the statement it returned are
   * the evidence, and they already exist.
   */
  batch?: PaymentBatch;
}

/**
 * Records that a document was paid, at its real rate, whoever was paid — a supplier invoice, a
 * claim, a compensation. Computes the FX gain/loss against the locked rate, persists it on a
 * `payment` record and emits `payment.settled` for external accounting. MUST NOT touch the budget
 * (invariant 6).
 *
 * This is the only path money-out takes. `document_settlement` was a second one for documents owed
 * to a person; it was a copy of a branch already generic — the GL posting clears whatever account
 * the accrual credited — and it could express neither withholding nor a bank account.
 */
@Injectable()
export class PaymentService {
  constructor(
    private readonly em: EntityManager,
    private readonly scope: CompanyScopeService,
    private readonly storage: StorageService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  /**
   * Record a payment against a document the company owes.
   *
   * `outerEm` lets a caller that already holds a transaction — a batch result import, which locks
   * its `payment_batch` row first — record inside it, so the payments and the batch's status commit
   * together. Omit it and the call opens its own transaction, which is the single-document path.
   *
   * Everything that can refuse the request runs BEFORE anything is written anywhere, the file
   * included. Object storage is not transactional, so an upload that precedes a validation leaves
   * an object behind for a payment that never existed — which is what the settlement flow did.
   */
  async record(
    documentId: string,
    input: RecordPaymentInput,
    outerEm?: EntityManager,
  ): Promise<PaymentResult> {
    const companyId = RequestContext.companyId()!;
    const userId = RequestContext.userId();
    const { whtTaxCodeId, reference, note, file, batch } = input;
    if (input.actualRate !== undefined && Money.compare(input.actualRate, '0') <= 0) {
      throw new BadRequestException('actualRate must be positive');
    }

    // A batch pays by transfer by definition; a hand-recorded payment says how the money moved.
    const method = input.method ?? 'TRANSFER';
    if (!(PAYMENT_METHODS as readonly string[]).includes(method)) {
      throw new BadRequestException(
        `Payment method '${method}' is not supported — use one of ${PAYMENT_METHODS.join(', ')}`,
      );
    }

    // Which of the company's accounts the money left. Asked of a transfer and only of a transfer:
    // cash left no bank account, and a field answered anyway is a column nobody can read later —
    // the next person cannot tell a real answer from whatever was in the form. Refused by name, the
    // way an unsupported method is, rather than silently becoming one of the two.
    const { transferFrom } = input;
    if (transferFrom && !(TRANSFER_SOURCES as readonly string[]).includes(transferFrom)) {
      throw new BadRequestException(
        `Transfer source '${transferFrom}' is not supported — use one of ${TRANSFER_SOURCES.join(', ')}`,
      );
    }

    // The document's existing slips, read once. They answer two questions at this point, and both
    // are about the same act: whether the money is already evidenced, and whether whoever paid
    // already said which account it left.
    //
    // Evidence is required exactly where nothing else proves the money moved (design D4). Checked
    // here, before the document is even read, so the cheapest refusal happens first and no file has
    // touched storage.
    let statedOnSlip: TransferSource | undefined;
    let rateOnSlip: string | undefined;
    if (!batch) {
      // "With the record" originally meant "in this request", because a slip could not exist any
      // earlier — `payment_attachment` hung off the payment being created here. A workflow step can
      // now demand a slip mid-approval, so the money is often already evidenced by the time this
      // runs, and insisting on the file again would make finance upload the same picture twice and
      // leave the document with two rows for one transfer. What the rule protects is unchanged: a
      // hand-recorded payment is never written without evidence behind it.
      const slips = await this.em.fork().find(
        PaymentAttachment,
        { document: documentId },
        {
          ...FILTER_OFF,
          fields: ['transferFrom', 'actualRate', 'uploadedAt'],
          orderBy: { uploadedAt: 'DESC' },
        },
      );
      // The most recent slip that states each. A later slip correcting an earlier one is a
      // correction, and reading the newest is what makes it take effect. Read independently: a
      // second slip may correct the account without restating the rate, or the other way round.
      statedOnSlip = slips.find((a) => a.transferFrom)?.transferFrom;
      rateOnSlip = slips.find((a) => a.actualRate)?.actualRate;
      if (!file && !slips.length) {
        throw new BadRequestException(
          'Evidence of the payment is required — attach the slip or receipt with the record, ' +
            'or attach it to the document first. ' +
            'Only a payment produced by a bank batch is evidenced by the file sent to the bank.',
        );
      }
      if (file) validateUpload(file, EVIDENCE_MIME_ALLOWLIST, SLIP_MAX_SIZE_KB);
    }

    // What this record says the transfer left, preferring what THIS request states over what the
    // slip said. Adopted from the slip otherwise: the person who attached it is the person who
    // paid, and asking them the same question again — later, about a transfer they can no longer
    // see — collects a worse answer than the one already stored.
    const stated = transferFrom ?? statedOnSlip;
    // The rate the FX gain/loss is computed against, on the same rule: this request's own figure
    // wins, otherwise the slip's. There is no third fallback — a rate the server invented would be
    // the system claiming to know what the bank did.
    const actualRate = input.actualRate ?? rateOnSlip;
    if (!actualRate) {
      throw new BadRequestException(
        'The actual exchange rate is required — state it on the transfer slip when attaching it, ' +
          'or supply it with the record.',
      );
    }
    // Required of a HAND-recorded transfer, on the same boundary the evidence rule uses: a payment
    // a bank run produced already names the configured `bank_account` that run paid from, which is
    // the stronger answer to the same question, and demanding this one as well would refuse every
    // batch import to collect a fact the row already carries.
    if (method === 'TRANSFER' && !batch && !stated) {
      throw new BadRequestException(
        `A transfer must say which account it left — one of ${TRANSFER_SOURCES.join(', ')}. ` +
          'It is normally stated on the transfer slip when that is attached.',
      );
    }
    // Stored only for a transfer: cash left no bank account, so a value arriving with one is
    // dropped rather than kept as a fact about a movement that never touched a bank.
    const transferSource = method === 'TRANSFER' ? stated : undefined;

    // Every predictable refusal, before the file reaches storage.
    await this.assertRecordable(documentId, companyId, !!batch);

    // Only now. A rolled-back transaction below leaves an unreferenced object, which is recoverable;
    // an upload ahead of the checks above left one for every request that was never going to succeed.
    const uploadedKey = file
      ? await (async () => {
          const key = this.storage.buildKey(documentId, file.originalname);
          await this.storage.putObject(key, file.buffer, file.mimetype);
          return key;
        })()
      : undefined;

    const run = async (tem: EntityManager) => {
      const doc = await tem.findOne(Document, { id: documentId }, { ...FILTER_OFF, populate: ['documentType', 'company'] });
      if (!doc || doc.company.id !== companyId) throw new NotFoundException(`Document ${documentId} not found`);
      // Re-read inside the transaction: `assertRecordable` answered the same question a moment ago
      // and this catches the instant between. The unique constraint on `document_id` is what
      // actually decides a true race; this is what turns it into a message instead of a 500.
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

      const payment = tem.create(Payment, {
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
        method,
        transferFrom: transferSource,
        reference,
        note,
        // Set here rather than patched by the caller afterwards: the run a payment came out of is
        // what decides whether it needed evidence, so the two facts belong to the same write.
        batch: batch ? tem.getReference(PaymentBatch, batch.id) : undefined,
        bankAccount: batch?.bankAccount,
        createdBy: userId ? tem.getReference(AppUser, userId) : undefined,
        paidAt: new Date(),
        createdAt: new Date(),
      });
      tem.persist(payment);

      // The evidence commits WITH the payment. Its bytes are already in storage — they had to be,
      // storage not being transactional — but the row that makes them findable is written here, so
      // a rolled-back payment leaves an unreferenced object rather than an unjustified payment.
      if (uploadedKey && file) {
        tem.persist(
          tem.create(PaymentAttachment, {
            company: tem.getReference(Company, companyId),
            document: tem.getReference(Document, documentId),
            payment,
            fileName: file.originalname,
            filePath: uploadedKey,
            fileSizeKb: Math.ceil(file.size / 1024),
            mimeType: file.mimetype,
            uploadedBy: tem.getReference(AppUser, userId!),
            uploadedAt: new Date(),
            // The slip states what the payment states: this file and this record are one act, and
            // a slip that says nothing beside a payment that does would read as a disagreement.
            transferFrom: transferSource,
            actualRate,
          }),
        );
      }

      await tem.flush();

      // Slips already on this document — uploaded so an approval step could be passed, before any
      // payment existed — are adopted by the payment that has now been recorded for the same money.
      // Adopted, not copied: they are already the evidence for this document, and a second row
      // would double the count every reader takes as "how many slips does this have".
      //
      // After the flush, not before: the update points a foreign key at `payment`, and until the
      // insert above has reached the database there is no row for it to point at.
      // FILTER_OFF like every other write in this transaction: `tem` is a raw transactional EM with
      // no company argument bound, and the scoping is already carried by `documentId`, which was
      // resolved inside the active company above.
      await tem.nativeUpdate(
        PaymentAttachment,
        { document: documentId, payment: null },
        { payment: payment.id },
        FILTER_OFF,
      );
      return {
        documentId, lockedRate, actualRate, baseLocked, baseActual, fxDelta, fxKind, whtAmount,
        transferFrom: transferSource,
      };
    };

    const result = outerEm ? await run(outerEm) : await inTransaction(this.em, run);

    // After commit: hand the FX breakdown to accounting.
    this.events?.emit('payment.settled', result);
    return result;
  }

  /**
   * Record the payment a completed document has ALREADY been paid with, from what its transfer slip
   * says — the automatic end of the flow this company actually runs.
   *
   * The money leaves the bank first. Finance attaches the slip at the approval step that demands
   * one, stating there which account it left and at what rate the bank converted it. The document
   * then finishes its remaining approvals. By the time it completes, everything a payment record
   * needs has been stated by the person who paid, and asking somebody else to retype it into a
   * "record payment" form days later collects a worse answer than the one already stored.
   *
   * Returns null — quietly, leaving the document in the ready-to-pay queue for someone to record by
   * hand — when the slips do not state both facts, or when a payment already exists. Falling back to
   * the manual path is what makes this safe to run off an event: the worst case is the behaviour
   * that shipped before it.
   *
   * Authorisation happened at the slip: attaching one requires `PAYMENT_MANAGE`, the same permission
   * the record endpoint demands, so this writes nothing a permitted person did not already state.
   */
  async recordFromSlip(documentId: string): Promise<PaymentResult | null> {
    const em = this.em.fork();
    if (await em.findOne(Payment, { document: documentId }, FILTER_OFF)) return null;

    const slips = await em.find(
      PaymentAttachment,
      { document: documentId },
      { ...FILTER_OFF, fields: ['transferFrom', 'actualRate', 'uploadedAt'], orderBy: { uploadedAt: 'DESC' } },
    );
    // Both, or nothing. A slip that names the account but no rate cannot produce an FX figure, and
    // a rate with no account would record money as leaving an account nobody named — either way the
    // honest outcome is to leave it for a person, not to guess half of it.
    const transferFrom = slips.find((a) => a.transferFrom)?.transferFrom;
    const actualRate = slips.find((a) => a.actualRate)?.actualRate;
    if (!transferFrom || !actualRate) return null;

    // Through `record`, not around it: the owed-document predicate, the period guard, the FX maths
    // and the `payment.settled` emit that drives GL posting are all its business, and a second way
    // to write a payment row is the defect this module already removed once.
    return this.record(documentId, {});
  }

  /**
   * Everything that can refuse this request, run before anything is written anywhere.
   *
   * The order is the point. Object storage is not transactional, so a file uploaded ahead of a
   * check that then refuses leaves an object nobody will ever look for — which is exactly what the
   * settlement flow did, and the reason a refused settlement cost the company a stray file every
   * time. Reading the document twice is the price, and it is one query.
   *
   * What remains after this is a genuine race — two payments recorded for one document at the same
   * instant — which the unique constraint on `payment.document_id` decides. The loser leaves an
   * unreferenced object, which a storage sweep can find; it does not leave a payment.
   */
  private async assertRecordable(
    documentId: string,
    companyId: string,
    fromBatch: boolean,
  ): Promise<void> {
    const em = this.em.fork();
    const doc = await em.findOne(
      Document,
      { id: documentId },
      { ...FILTER_OFF, populate: ['documentType', 'company'] },
    );
    if (!doc || doc.company.id !== companyId) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }
    if (doc.status !== DocStatus.COMPLETED) {
      throw new BadRequestException('Only a fully approved document can be paid');
    }
    if (await em.findOne(Payment, { document: documentId }, FILTER_OFF)) {
      throw new BadRequestException('Document already has a recorded payment');
    }
    if (fromBatch) return;
    const owedNow = await owedDocuments(this.scope.forActiveCompany(), em, companyId, [documentId]);
    if (!owedNow.length) {
      throw new BadRequestException(
        `Document ${doc.docNo} is not something the company owes: nothing was accrued for it ` +
          'and its type is not paid through this flow',
      );
    }
  }
}

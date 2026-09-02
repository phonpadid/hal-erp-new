import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContext } from '../../common/context/request-context';
import { DocStatus } from '../../common/enums';
import { Money } from '../../common/money/money';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { StorageService } from '../../common/storage/storage.service';
import { validateUpload, type UploadedFile } from '../../common/storage/upload';
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
}

/** What one recorded payment states beyond its rate. */
export interface RecordPaymentInput {
  actualRate: string;
  whtTaxCodeId?: string;
  method?: string;
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
    const { actualRate, whtTaxCodeId, reference, note, file, batch } = input;
    if (Money.compare(actualRate, '0') <= 0) throw new BadRequestException('actualRate must be positive');

    // A batch pays by transfer by definition; a hand-recorded payment says how the money moved.
    const method = input.method ?? 'TRANSFER';
    if (!(PAYMENT_METHODS as readonly string[]).includes(method)) {
      throw new BadRequestException(
        `Payment method '${method}' is not supported — use one of ${PAYMENT_METHODS.join(', ')}`,
      );
    }

    // Evidence is required exactly where nothing else proves the money moved (design D4). Validated
    // here, before the document is even read, so the cheapest refusal happens first and no file has
    // touched storage.
    if (!batch) {
      // "With the record" originally meant "in this request", because a slip could not exist any
      // earlier — `payment_attachment` hung off the payment being created here. A workflow step can
      // now demand a slip mid-approval, so the money is often already evidenced by the time this
      // runs, and insisting on the file again would make finance upload the same picture twice and
      // leave the document with two rows for one transfer. What the rule protects is unchanged: a
      // hand-recorded payment is never written without evidence behind it.
      const alreadyEvidenced =
        (await this.em.fork().count(PaymentAttachment, { document: documentId }, FILTER_OFF)) > 0;
      if (!file && !alreadyEvidenced) {
        throw new BadRequestException(
          'Evidence of the payment is required — attach the slip or receipt with the record, ' +
            'or attach it to the document first. ' +
            'Only a payment produced by a bank batch is evidenced by the file sent to the bank.',
        );
      }
      if (file) validateUpload(file, null, SLIP_MAX_SIZE_KB);
    }

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
      return { documentId, lockedRate, actualRate, baseLocked, baseActual, fxDelta, fxKind, whtAmount };
    };

    const result = outerEm ? await run(outerEm) : await inTransaction(this.em, run);

    // After commit: hand the FX breakdown to accounting.
    this.events?.emit('payment.settled', result);
    return result;
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

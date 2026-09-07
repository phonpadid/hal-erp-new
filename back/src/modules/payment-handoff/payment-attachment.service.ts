import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { TRANSFER_SOURCES, type TransferSource } from '@erp/shared';
import { Money } from '../../common/money/money';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { coded, ErrorCode } from '../../common/errors/error-code';
import { DocumentApprovalStep, ROUTE_STEP_STATUS } from '../approval/approval.entities';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { StorageService } from '../../common/storage/storage.service';
import {
  EVIDENCE_MIME_ALLOWLIST,
  validateUpload,
  type UploadedFile,
} from '../../common/storage/upload';
import { Document } from '../document/document.entities';
import { DocumentRateService, type RestatedRate } from '../document/document-rate.service';
import { Company } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { Payment, PaymentAttachment } from './payment.entities';

/** Slips accept the same three types as a document attachment: a photo, or a PDF from the bank. */
export const SLIP_MAX_SIZE_KB = 10 * 1024; // 10 MB, matching document attachments.

/**
 * The slips proving money left the bank: metadata here, bytes in S3/MinIO.
 *
 * Never parsed — a slip is evidence for a human. The file the system reads is the bank's RESULT
 * file, which travels the other way and belongs to `payment_batch`.
 *
 * Everything here resolves through the DOCUMENT, not through its payment. That is not merely how
 * the routes are addressed; it is when a slip can exist. A workflow may require evidence at an
 * approval step, and at that point the money has moved but `recordPayment` has not run, so there is
 * no payment to hang the slip on. Resolving by document makes the mid-approval slip and the
 * after-payment slip the same object, read by the same queries, instead of two kinds of evidence
 * every reader would have to union.
 *
 * Writes no `budget_txn` or `quota_usage`: the budget settled to ACTUAL when the document
 * completed, and attaching a picture of a transfer settles nothing.
 */
@Injectable()
export class PaymentAttachmentService {
  constructor(
    private readonly em: EntityManager,
    private readonly scope: CompanyScopeService,
    private readonly storage: StorageService,
    private readonly rates: DocumentRateService,
  ) {}

  /**
   * State the rate this document's money converted at, restating the document by it.
   *
   * The one place both entries land: this route, and a slip upload that carries a rate. Two ways in
   * and one implementation, so a correction made without a file and one made with one cannot come
   * to mean different things.
   */
  stateRate(documentId: string, actualRate: string): Promise<RestatedRate> {
    return this.rates.restate(documentId, actualRate);
  }

  /**
   * Attach a slip to a document.
   *
   * Resolving through the active company first makes another company's id not-found rather than a
   * silent cross-company write, and `company` is copied from the resolved document — never taken
   * from the request. The payment is looked up and linked when one exists; when it does not, the
   * slip is written with a null `payment` and `recordPayment` adopts it later.
   *
   * `transferFrom` says which of the company's own accounts the transfer left, and `actualRate` the
   * rate the money actually converted at. Both are asked here because here is where they are known:
   * the person attaching the slip is the person who paid, and the bank's rate for that day is on the
   * document in their hand. Nobody clearing the payment queue a week later can recover either.
   *
   * Both optional at this boundary — a slip can evidence cash, and slips attached before these were
   * asked carry neither — but a value that is given must be valid: the account one of the pair, and
   * the rate positive. Refused by name rather than stored.
   */
  async upload(
    documentId: string,
    file: UploadedFile,
    transferFrom?: TransferSource,
    actualRate?: string,
  ): Promise<PaymentAttachment> {
    const document = await this.requireDocument(documentId);
    if (transferFrom && !(TRANSFER_SOURCES as readonly string[]).includes(transferFrom)) {
      throw new BadRequestException(
        `Transfer source '${transferFrom}' is not supported — use one of ${TRANSFER_SOURCES.join(', ')}`,
      );
    }
    // The same rule the record endpoint applies to the rate it is handed. A zero or negative rate
    // is not a slow way to say "no rate": it is a number that would divide the FX computation.
    if (actualRate !== undefined && Money.compare(actualRate, '0') <= 0) {
      throw new BadRequestException('actualRate must be positive');
    }
    validateUpload(file, EVIDENCE_MIME_ALLOWLIST, SLIP_MAX_SIZE_KB);
    // Keyed by document, which every slip has, rather than by payment, which a mid-approval slip
    // does not. Two slips on one document still differ by the key the storage layer builds.
    const key = this.storage.buildKey(document.id, file.originalname);
    await this.storage.putObject(key, file.buffer, file.mimetype);
    const em = this.scope.forActiveCompany();
    const payment = await em.findOne(Payment, { document: document.id });
    const attachment = em.create(PaymentAttachment, {
      company: em.getReference(Company, document.company.id),
      document: em.getReference(Document, document.id),
      payment: payment ? em.getReference(Payment, payment.id) : undefined,
      fileName: file.originalname,
      filePath: key,
      fileSizeKb: Math.ceil(file.size / 1024),
      mimeType: file.mimetype,
      uploadedBy: em.getReference(AppUser, RequestContext.userId()!),
      uploadedAt: new Date(),
      transferFrom,
      actualRate,
    });
    await em.persistAndFlush(attachment);

    // The slip's rate is the document's rate. Restating is refused where it should be — a document
    // past its last approval, or already paid — and a slip attached to one of those is still
    // perfectly valid evidence, so a refusal here must not lose the file that was just stored.
    if (actualRate !== undefined) {
      try {
        await this.rates.restate(documentId, actualRate);
      } catch {
        // Deliberately swallowed and deliberately narrow: the slip is written either way, and the
        // caller that wants the restatement to be the point calls `stateRate`, which refuses loudly.
      }
    }
    return attachment;
  }

  /** A document's slip metadata, scoped to the active company. `filePath` is never returned. */
  async list(documentId: string): Promise<
    Array<{
      id: string;
      fileName: string;
      fileSizeKb?: number;
      mimeType?: string;
      uploadedAt?: Date;
      transferFrom?: TransferSource;
      actualRate?: string;
    }>
  > {
    const document = await this.requireDocument(documentId);
    const rows = await this.scope
      .forActiveCompany()
      .find(PaymentAttachment, { document: document.id }, { orderBy: { uploadedAt: 'ASC' } });
    return rows.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      fileSizeKb: a.fileSizeKb,
      mimeType: a.mimeType,
      uploadedAt: a.uploadedAt,
      // Read back beside the file it belongs to: whoever checks the slip later sees which account
      // the person who attached it said the money left, and at what rate.
      transferFrom: a.transferFrom,
      actualRate: a.actualRate,
    }));
  }

  /** Short-lived presigned GET URL for one slip — the storage key never reaches the client. */
  async downloadUrl(documentId: string, attachmentId: string): Promise<{ url: string }> {
    const attachment = await this.requireAttachment(documentId, attachmentId);
    return { url: await this.storage.presignDownload(attachment.filePath) };
  }

  /**
   * Delete a slip, row and object both.
   *
   * A row without bytes is a broken download; bytes without a row are unreachable and still hold
   * the file's contents — the realistic reason to delete is the wrong customer's slip, which is a
   * privacy problem a compensating upload cannot fix. The object goes only after the row commits:
   * an orphaned object is recoverable by a sweep, whereas deleting bytes first and then failing
   * the commit leaves a row pointing at nothing.
   *
   * Takes the document's row lock first. A step may be approvable only while a slip is attached, and
   * that gate reads the same rows under the same lock — without it, a delete committing between the
   * gate's read and the approval's commit would leave a step approved against evidence that no
   * longer exists. Locking here makes the two serialise: either the delete lands first and the
   * approval is refused, or the approval commits and the delete follows it. Upload deliberately
   * takes no such lock, because adding evidence cannot produce a wrong outcome either way.
   */
  async remove(documentId: string, attachmentId: string): Promise<void> {
    const attachment = await this.requireAttachment(documentId, attachmentId);

    // A step that demanded evidence and was approved on it must not end up with none. The gate in
    // the approve path can only refuse an approval that has not happened yet; nothing there reaches
    // backwards, so without this the evidence a signature rests on could be deleted the minute
    // after it was given, leaving an `approval_log` row asserting something no longer provable.
    //
    // Scoped to the LAST remaining slip, deliberately. Deleting one of several is how a wrong file
    // gets corrected, and refusing that would push people to leave the wrong customer's slip
    // attached — which is the privacy problem `remove` exists to solve.
    const em = this.scope.forActiveCompany();
    const passedOnEvidence = await em.count(DocumentApprovalStep, {
      document: documentId,
      requiresPaymentSlip: true,
      status: ROUTE_STEP_STATUS.DONE,
      supersededAt: null,
    });
    if (passedOnEvidence > 0) {
      const remaining = await em.count(PaymentAttachment, { document: documentId });
      if (remaining <= 1) {
        throw coded(
          ErrorCode.EVIDENCE_IS_LOAD_BEARING,
          'This is the only transfer slip on a document whose approval required one. ' +
            'Attach the replacement first, then remove this.',
        );
      }
    }

    // Deleted through the company-scoped EM above: PaymentAttachment carries the `company` filter,
    // and a raw fork throws "No arguments provided for filter 'company'" rather than deleting.
    const key = attachment.filePath;
    await em.transactional(async (tem) => {
      await tem.findOne(Document, { id: documentId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      await tem.nativeDelete(PaymentAttachment, { id: attachment.id });
    });
    await this.storage.deleteObject(key);
  }

  /** Resolve the document within the active company — a cross-company id is not-found. */
  private async requireDocument(documentId: string): Promise<Document> {
    const document = await this.scope
      .forActiveCompany()
      .findOne(Document, { id: documentId }, { populate: ['company'] });
    if (!document) throw new NotFoundException(`Document ${documentId} not found`);
    return document;
  }

  private async requireAttachment(documentId: string, attachmentId: string): Promise<PaymentAttachment> {
    const document = await this.requireDocument(documentId);
    const attachment = await this.scope
      .forActiveCompany()
      .findOne(PaymentAttachment, { id: attachmentId, document: document.id });
    if (!attachment) throw new NotFoundException(`Slip ${attachmentId} not found`);
    return attachment;
  }
}

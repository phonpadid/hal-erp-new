import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { StorageService } from '../../common/storage/storage.service';
import { validateUpload, type UploadedFile } from '../../common/storage/upload';
import { Company } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { Payment, PaymentAttachment } from './payment.entities';

/** Slips accept any file type (a photo, a PDF from the bank); only a size cap is enforced. */
export const SLIP_MAX_SIZE_KB = 10 * 1024; // 10 MB, matching document attachments.

/**
 * The slips proving a payment left the bank: metadata here, bytes in S3/MinIO.
 *
 * Never parsed — a slip is evidence for a human. The file the system reads is the bank's RESULT
 * file, which travels the other way and belongs to `payment_batch`.
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
  ) {}

  /**
   * Attach a slip to a document's payment.
   *
   * Keyed by DOCUMENT id, like the rest of this controller's surface (`POST /payments/:documentId`
   * records one, and the queue lists documents): `payment` is unique per document, and the client
   * is never told the payment's own id. Resolving through the active company first makes another
   * company's id not-found rather than a silent cross-company write, and `company` is copied from
   * the resolved payment — never taken from the request.
   *
   * A document with no payment yet is not-found: there is nothing to be evidence OF.
   */
  async upload(documentId: string, file: UploadedFile): Promise<PaymentAttachment> {
    const payment = await this.requirePayment(documentId);
    validateUpload(file, null, SLIP_MAX_SIZE_KB);
    const key = this.storage.buildKey(payment.id, file.originalname);
    await this.storage.putObject(key, file.buffer, file.mimetype);
    const em = this.em.fork();
    const attachment = em.create(PaymentAttachment, {
      company: em.getReference(Company, payment.company.id),
      payment: em.getReference(Payment, payment.id),
      fileName: file.originalname,
      filePath: key,
      fileSizeKb: Math.ceil(file.size / 1024),
      mimeType: file.mimetype,
      uploadedBy: em.getReference(AppUser, RequestContext.userId()!),
      uploadedAt: new Date(),
    });
    await em.persistAndFlush(attachment);
    return attachment;
  }

  /** A payment's slip metadata, scoped to the active company. `filePath` is never returned. */
  async list(documentId: string): Promise<
    Array<{ id: string; fileName: string; fileSizeKb?: number; mimeType?: string; uploadedAt?: Date }>
  > {
    const payment = await this.requirePayment(documentId);
    const rows = await this.scope
      .forActiveCompany()
      .find(PaymentAttachment, { payment: payment.id }, { orderBy: { uploadedAt: 'ASC' } });
    return rows.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      fileSizeKb: a.fileSizeKb,
      mimeType: a.mimeType,
      uploadedAt: a.uploadedAt,
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
   */
  async remove(documentId: string, attachmentId: string): Promise<void> {
    const attachment = await this.requireAttachment(documentId, attachmentId);
    const key = attachment.filePath;
    // Delete through the company-scoped EM: PaymentAttachment carries the `company` filter, and a
    // raw fork throws "No arguments provided for filter 'company'" rather than deleting.
    const em = this.scope.forActiveCompany();
    await em.transactional(async (tem) => {
      await tem.nativeDelete(PaymentAttachment, { id: attachment.id });
    });
    await this.storage.deleteObject(key);
  }

  /** Resolve the document's payment within the active company — a cross-company id is not-found. */
  private async requirePayment(documentId: string): Promise<Payment> {
    const payment = await this.scope
      .forActiveCompany()
      .findOne(Payment, { document: documentId }, { populate: ['company'] });
    if (!payment) throw new NotFoundException(`No payment recorded for document ${documentId}`);
    return payment;
  }

  private async requireAttachment(documentId: string, attachmentId: string): Promise<PaymentAttachment> {
    const payment = await this.requirePayment(documentId);
    const attachment = await this.scope
      .forActiveCompany()
      .findOne(PaymentAttachment, { id: attachmentId, payment: payment.id });
    if (!attachment) throw new NotFoundException(`Slip ${attachmentId} not found`);
    return attachment;
  }
}

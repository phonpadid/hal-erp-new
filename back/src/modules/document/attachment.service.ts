import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { DocStatus } from '../../common/enums';
import { coded, ErrorCode } from '../../common/errors/error-code';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { StorageService } from '../../common/storage/storage.service';
import {
  EVIDENCE_MIME_ALLOWLIST,
  extensionFor,
  validateUpload,
  type UploadedFile,
} from '../../common/storage/upload';
import { AppUser } from '../rbac/rbac.entities';
import { Document, DocumentAttachment } from './document.entities';

/**
 * Attachments accept PDF, JPEG and PNG — the types that can be printed into the document set the
 * attachment is evidence for. Anything else is refused here rather than accepted and then shown as
 * a page saying it could not be printed.
 *
 * Files stored before this narrowed keep working: nothing here touches reads, so an older
 * attachment is still listed and still downloadable through its presigned URL.
 */
export const ATTACHMENT_MAX_SIZE_KB = 10 * 1024; // 10 MB, matching the client picker cap.

/** Attachment metadata only — file bytes live in S3/MinIO, never in the DB. */
@Injectable()
export class AttachmentService {
  constructor(
    private readonly em: EntityManager,
    private readonly scope: CompanyScopeService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Upload a document attachment (multipart). Resolves the document in the active company,
   * validates the size cap on the received bytes, writes them to object storage server-side,
   * and records the metadata (filePath = the object key). The browser never PUTs to the bucket.
   *
   * The system names the file: `<doc_no>-<nn><ext>`, where `nn` counts this document's
   * attachments in upload order and `ext` follows the type the bytes were checked against. A
   * page that falls out of a printed set can then be tied back to its document, which a Lao
   * filename never could — and never had to. What the uploader called the file is kept beside it
   * in `original_file_name`, decoded as UTF-8 (see `multipartOptions`), for recognition only.
   *
   * The sequence is read under the document's row lock in the same transaction that writes the
   * row: two files dropped together must come out `-01` and `-02`, the way document numbering
   * itself is protected. The object is written first, under the generated name's key, and the
   * row after — a storage failure leaves no row pointing at nothing.
   */
  async upload(documentId: string, file: UploadedFile): Promise<DocumentAttachment> {
    const document = await this.requireDocument(documentId);
    validateUpload(file, EVIDENCE_MIME_ALLOWLIST, ATTACHMENT_MAX_SIZE_KB);
    const userId = RequestContext.userId()!;
    const ext = extensionFor(file.mimetype);
    return this.em.transactional(async (em) => {
      const locked = await em.findOne(
        Document,
        { id: document.id },
        { filters: { company: false }, lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!locked) throw new NotFoundException(`Document ${documentId} not found`);
      const nn = (await this.highestSequence(em, locked.id, locked.docNo)) + 1;
      const fileName = `${locked.docNo}-${String(nn).padStart(2, '0')}${ext}`;
      const key = this.storage.buildKey(documentId, fileName);
      await this.storage.putObject(key, file.buffer, file.mimetype);
      const attachment = em.create(DocumentAttachment, {
        document: em.getReference(Document, locked.id),
        fileName,
        originalFileName: file.originalname,
        filePath: key,
        fileSizeKb: Math.ceil(file.size / 1024),
        mimeType: file.mimetype,
        uploadedBy: em.getReference(AppUser, userId),
        uploadedAt: new Date(),
      });
      em.persist(attachment);
      return attachment;
    });
  }

  /** List a document's attachment metadata, scoped to the active company. */
  async list(documentId: string): Promise<
    Array<{
      id: string;
      fileName: string;
      originalFileName: string | null;
      fileSizeKb?: number;
      mimeType?: string;
      uploadedAt?: Date;
    }>
  > {
    await this.requireDocument(documentId);
    // Query through the active-company scope so the company filter auto-joined from the
    // (company-scoped) Document relation has its companyId bound; requireDocument already
    // asserted the document belongs to the active company.
    const rows = await this.scope.forActiveCompany().find(
      DocumentAttachment,
      { document: documentId },
      { orderBy: { uploadedAt: 'ASC' } },
    );
    return rows.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      originalFileName: a.originalFileName ?? null,
      fileSizeKb: a.fileSizeKb,
      mimeType: a.mimeType,
      uploadedAt: a.uploadedAt,
    }));
  }

  /** Short-lived presigned GET URL for one attachment, scoped to the active company. */
  async downloadUrl(documentId: string, attachmentId: string): Promise<{ url: string }> {
    await this.requireDocument(documentId);
    // Query through the active-company scope so the `company` filter — applied via the
    // (company-scoped) Document relation referenced in the where — has its companyId
    // bound; a raw `this.em` query throws "No arguments provided for filter 'company'".
    const attachment = await this.scope.forActiveCompany().findOne(DocumentAttachment, {
      id: attachmentId,
      document: documentId,
    });
    if (!attachment) throw new NotFoundException(`Attachment ${attachmentId} not found`);
    return { url: await this.storage.presignDownload(attachment.filePath) };
  }

  /**
   * Remove an attachment from a DRAFT — the way a wrong file is corrected before anyone sees it.
   *
   * Only a DRAFT, for the reason its lines and field values are editable only then: once
   * submitted, the attachments are what the approvers read and decided on, and the printed set
   * carries them. Removing one there would leave an approval standing on evidence that is gone.
   *
   * Taken under the document's row lock, the lock `upload` numbers under and `submit` holds, so a
   * delete cannot land beside a submit that has already read the set. The object goes only after
   * the row commits: an orphaned object is recoverable, a row pointing at deleted bytes is not.
   */
  async remove(documentId: string, attachmentId: string): Promise<void> {
    await this.requireDocument(documentId);
    const key = await this.em.transactional(async (em) => {
      const locked = await em.findOne(
        Document,
        { id: documentId },
        { filters: { company: false }, lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!locked) throw new NotFoundException(`Document ${documentId} not found`);
      if (locked.status !== DocStatus.DRAFT) {
        throw coded(
          ErrorCode.INVALID_STATE,
          `A ${locked.status} document's attachments cannot be removed — only a DRAFT's can`,
        );
      }
      const attachment = await em.findOne(
        DocumentAttachment,
        { id: attachmentId, document: locked.id },
        { filters: { company: false } },
      );
      if (!attachment) throw new NotFoundException(`Attachment ${attachmentId} not found`);
      await em.nativeDelete(DocumentAttachment, { id: attachment.id });
      return attachment.filePath;
    });
    await this.storage.deleteObject(key);
  }

  /**
   * The highest `nn` among this document's attachment names. Counting the rows was the same number
   * only while nothing could be removed: with `-01` and `-02` stored and `-01` removed, a count
   * names the next upload `-02` a second time.
   */
  private async highestSequence(em: EntityManager, documentId: string, docNo: string): Promise<number> {
    const rows = await em.find(DocumentAttachment, { document: documentId }, { filters: { company: false } });
    const prefix = `${docNo}-`;
    return rows.reduce((max, a) => {
      if (!a.fileName.startsWith(prefix)) return max;
      const n = Number.parseInt(a.fileName.slice(prefix.length), 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
  }

  /** Resolve the document within the active company — a cross-company id is not-found. */
  private async requireDocument(documentId: string): Promise<Document> {
    const document = await this.scope.forActiveCompany().findOne(Document, { id: documentId });
    if (!document) throw new NotFoundException(`Document ${documentId} not found`);
    return document;
  }
}

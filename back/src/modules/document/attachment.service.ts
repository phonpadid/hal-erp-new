import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { StorageService } from '../../common/storage/storage.service';
import { validateUpload, type UploadedFile } from '../../common/storage/upload';
import { AppUser } from '../rbac/rbac.entities';
import { Document, DocumentAttachment } from './document.entities';

/** Attachments accept any file type (PDF, image, …); only a size cap is enforced. */
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
   */
  async upload(documentId: string, file: UploadedFile): Promise<DocumentAttachment> {
    const document = await this.requireDocument(documentId);
    validateUpload(file, null, ATTACHMENT_MAX_SIZE_KB);
    const key = this.storage.buildKey(documentId, file.originalname);
    await this.storage.putObject(key, file.buffer, file.mimetype);
    const userId = RequestContext.userId()!;
    const em = this.em.fork();
    const attachment = em.create(DocumentAttachment, {
      document: em.getReference(Document, document.id),
      fileName: file.originalname,
      filePath: key,
      fileSizeKb: Math.ceil(file.size / 1024),
      mimeType: file.mimetype,
      uploadedBy: em.getReference(AppUser, userId),
      uploadedAt: new Date(),
    });
    await em.persistAndFlush(attachment);
    return attachment;
  }

  /** List a document's attachment metadata, scoped to the active company. */
  async list(documentId: string): Promise<
    Array<{ id: string; fileName: string; fileSizeKb?: number; mimeType?: string; uploadedAt?: Date }>
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

  /** Resolve the document within the active company — a cross-company id is not-found. */
  private async requireDocument(documentId: string): Promise<Document> {
    const document = await this.scope.forActiveCompany().findOne(Document, { id: documentId });
    if (!document) throw new NotFoundException(`Document ${documentId} not found`);
    return document;
  }
}

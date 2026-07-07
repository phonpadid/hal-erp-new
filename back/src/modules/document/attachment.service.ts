import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { StorageService } from '../../common/storage/storage.service';
import { AppUser } from '../rbac/rbac.entities';
import { Document, DocumentAttachment } from './document.entities';
import type { PresignUploadDto, RegisterAttachmentDto } from './dto/document.dto';

/** Attachment metadata only — file bytes live in S3/MinIO, never in the DB. */
@Injectable()
export class AttachmentService {
  constructor(
    private readonly em: EntityManager,
    private readonly scope: CompanyScopeService,
    private readonly storage: StorageService,
  ) {}

  /** Step 1: presigned PUT URL for direct browser→bucket upload. Scoped to active company. */
  async presignUpload(
    documentId: string,
    dto: PresignUploadDto,
  ): Promise<{ uploadUrl: string; key: string; fileName: string }> {
    await this.requireDocument(documentId);
    const key = this.storage.buildKey(documentId, dto.fileName);
    const uploadUrl = await this.storage.presignUpload(key, dto.contentType);
    return { uploadUrl, key, fileName: dto.fileName };
  }

  /** Step 3: record the uploaded object's metadata (filePath = the object key). */
  async register(documentId: string, dto: RegisterAttachmentDto): Promise<DocumentAttachment> {
    const document = await this.requireDocument(documentId);
    const userId = RequestContext.userId()!;
    const em = this.em.fork();
    const attachment = em.create(DocumentAttachment, {
      document: em.getReference(Document, document.id),
      fileName: dto.fileName,
      filePath: dto.filePath,
      fileSizeKb: dto.fileSizeKb,
      mimeType: dto.mimeType,
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
    const attachment = await this.em.findOne(DocumentAttachment, {
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

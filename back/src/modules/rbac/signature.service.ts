import { LockMode } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { StorageService } from '../../common/storage/storage.service';
import { validateUpload, type UploadedFile } from '../../common/storage/upload';
import { ApprovalLog } from '../approval/approval.entities';
import { AppUser, UserSignature } from './rbac.entities';
import { SIGNATURE_MAX_SIZE_KB, SIGNATURE_MIME_ALLOWLIST } from './dto/signature.dto';

const FILTER_OFF = { filters: { company: false } } as const;

/** The signed-in user's own current signature (or absence of one). */
export interface OwnSignature {
  hasSignature: boolean;
  signature: { id: string; mimeType: string | null; uploadedAt: Date | null; url: string } | null;
}

/**
 * Own-signature surface (document-signatures). The user is always resolved from the JWT,
 * never a path id, so a user can only read or replace their OWN signature. The image is
 * POSTed to the backend, which validates and writes it to S3/MinIO; only the object key +
 * metadata are stored. Rows are immutable — replacing inserts a new row and re-points
 * currentSignature, never overwriting the old file, so stamped approvals keep resolving to
 * the exact image.
 */
@Injectable()
export class SignatureService {
  constructor(
    private readonly em: EntityManager,
    private readonly storage: StorageService,
  ) {}

  /**
   * Upload the signed-in user's signature image: validate (image allow-list + size cap),
   * write the bytes to object storage, then record a NEW immutable user_signature row and
   * re-point app_user.current_signature_id at it. The DB write runs in one transaction with a
   * row lock so concurrent replaces can't interleave and leave current pointing at a
   * half-written row. The browser never PUTs to the bucket.
   */
  async upload(userId: string, file: UploadedFile): Promise<OwnSignature> {
    validateUpload(file, SIGNATURE_MIME_ALLOWLIST, SIGNATURE_MAX_SIZE_KB);
    const key = this.storage.buildUserSignatureKey(userId, file.originalname);
    await this.storage.putObject(key, file.buffer, file.mimetype);
    return this.em.transactional(async (em) => {
      const user = await em.findOne(AppUser, { id: userId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      if (!user) throw new UnauthorizedException('Unknown account');
      const signature = em.create(UserSignature, {
        user: em.getReference(AppUser, userId),
        filePath: key,
        mimeType: file.mimetype,
        fileSizeKb: Math.ceil(file.size / 1024),
        uploadedAt: new Date(),
      });
      em.persist(signature);
      await em.flush(); // assign the row's id before pointing current at it
      user.currentSignatureId = signature.id; // re-point; the previous row/file is left intact
      await em.flush();
      return this.present(signature);
    });
  }

  /**
   * Remove the background from a signature image via remove.bg, returning a transparent PNG.
   * The API key is held server-side (REMOVE_BG_API_KEY) and never exposed to the client.
   */
  async removeBackground(input: Buffer, mimeType: string): Promise<Buffer> {
    const apiKey = process.env.REMOVE_BG_API_KEY;
    if (!apiKey) throw new InternalServerErrorException('Background removal is not configured');
    const form = new FormData();
    form.append('size', 'auto');
    form.append('image_file', new Blob([new Uint8Array(input)], { type: mimeType }), 'signature.png');
    const res = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey },
      body: form,
    });
    if (!res.ok) throw new BadRequestException(`Background removal failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** The signed-in user's current signature, or an empty state — never another user's. */
  async getCurrent(userId: string): Promise<OwnSignature> {
    const em = this.em.fork();
    const user = await em.findOne(AppUser, { id: userId });
    if (!user) throw new UnauthorizedException('Unknown account');
    if (!user.currentSignatureId) return { hasSignature: false, signature: null };
    const signature = await em.findOne(UserSignature, { id: user.currentSignatureId });
    if (!signature) return { hasSignature: false, signature: null };
    return this.present(signature);
  }

  /**
   * Delete a signature file — refused while any approval_log row references it, so a
   * historical PDF can never lose the exact image it was signed with. (Replacing a
   * signature never deletes; this is a safety net for explicit removal only.)
   */
  async delete(userId: string, signatureId: string): Promise<void> {
    await this.em.transactional(async (em) => {
      const signature = await em.findOne(UserSignature, { id: signatureId, user: userId });
      if (!signature) throw new BadRequestException('Signature not found');
      const referenced = await em.count(ApprovalLog, { signature: signatureId }, FILTER_OFF);
      if (referenced > 0) {
        throw new BadRequestException('Signature is referenced by an approval and cannot be deleted');
      }
      const user = await em.findOne(AppUser, { id: userId });
      if (user?.currentSignatureId === signatureId) user.currentSignatureId = undefined;
      em.remove(signature);
    });
  }

  private async present(signature: UserSignature): Promise<OwnSignature> {
    return {
      hasSignature: true,
      signature: {
        id: signature.id,
        mimeType: signature.mimeType ?? null,
        uploadedAt: signature.uploadedAt ?? null,
        url: await this.storage.presignDownload(signature.filePath),
      },
    };
  }
}

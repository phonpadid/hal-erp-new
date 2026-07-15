import { IsIn, IsString } from 'class-validator';

/** Signature images are small — only PNG/JPEG, capped so PDF embedding stays bounded. */
export const SIGNATURE_MIME_ALLOWLIST = ['image/png', 'image/jpeg'] as const;
export const SIGNATURE_MAX_SIZE_KB = 1024; // 1 MB is plenty for a signature stamp.

/** Send a (cropped) signature image for server-side background removal. */
export class RemoveBackgroundDto {
  @IsString()
  imageBase64!: string;

  @IsIn(SIGNATURE_MIME_ALLOWLIST as unknown as string[])
  mimeType!: (typeof SIGNATURE_MIME_ALLOWLIST)[number];
}

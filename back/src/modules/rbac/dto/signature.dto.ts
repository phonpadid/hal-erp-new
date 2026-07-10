import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Signature images are small — only PNG/JPEG, capped so PDF embedding stays bounded. */
export const SIGNATURE_MIME_ALLOWLIST = ['image/png', 'image/jpeg'] as const;
export const SIGNATURE_MAX_SIZE_KB = 1024; // 1 MB is plenty for a signature stamp.

/** Step 1: ask for a presigned PUT URL. contentType is constrained to the image allow-list. */
export class PresignSignatureDto {
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsIn(SIGNATURE_MIME_ALLOWLIST as unknown as string[])
  contentType!: (typeof SIGNATURE_MIME_ALLOWLIST)[number];
}

/** Send a (cropped) signature image for server-side background removal. */
export class RemoveBackgroundDto {
  @IsString()
  imageBase64!: string;

  @IsIn(SIGNATURE_MIME_ALLOWLIST as unknown as string[])
  mimeType!: (typeof SIGNATURE_MIME_ALLOWLIST)[number];
}

/** Step 3: register the uploaded object as the user's new current signature. */
export class RegisterSignatureDto {
  @IsString()
  @MaxLength(1024)
  filePath!: string;

  @IsIn(SIGNATURE_MIME_ALLOWLIST as unknown as string[])
  mimeType!: (typeof SIGNATURE_MIME_ALLOWLIST)[number];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(SIGNATURE_MAX_SIZE_KB)
  fileSizeKb?: number;
}

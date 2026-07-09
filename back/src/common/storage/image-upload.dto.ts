import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Allowed profile-image types + size cap (kept in sync with the client-side guard). */
export const PROFILE_IMAGE_MIME_ALLOWLIST = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const PROFILE_IMAGE_MAX_SIZE_KB = 5 * 1024; // 5 MB

/** Step 1: ask for a presigned PUT URL for a profile image. */
export class PresignImageDto {
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsIn(PROFILE_IMAGE_MIME_ALLOWLIST as unknown as string[])
  contentType!: (typeof PROFILE_IMAGE_MIME_ALLOWLIST)[number];
}

/** Step 3: register the uploaded object as the new current profile image. */
export class RegisterImageDto {
  @IsString()
  @MaxLength(1024)
  filePath!: string;

  @IsIn(PROFILE_IMAGE_MIME_ALLOWLIST as unknown as string[])
  mimeType!: (typeof PROFILE_IMAGE_MIME_ALLOWLIST)[number];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PROFILE_IMAGE_MAX_SIZE_KB)
  fileSizeKb?: number;
}

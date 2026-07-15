import { IsDateString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** Issue a new API key bound to a target user in the caller's active company. */
export class IssueApiKeyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  // The user the key rides — must be a member of the caller's active company.
  @IsUUID()
  targetUserId!: string;

  // Optional expiry; omit for a non-expiring key.
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

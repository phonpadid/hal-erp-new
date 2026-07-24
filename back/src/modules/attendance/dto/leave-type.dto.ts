import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/**
 * Timing is two day-counts rather than a boolean plus a limit: "backdating allowed but no limit
 * set" would mean nothing in particular, whereas 0 says exactly one thing.
 */
export class UpsertLeaveTypeDto {
  @IsUUID()
  quotaId!: string;

  /** Days between filing and the leave starting. 0 allows filing on the day. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  advanceNoticeDays?: number;

  /** Days after the leave started during which it may still be filed. 0 forbids backdating. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  backdateLimitDays?: number;

  /** Consecutive days beyond which an attachment is required; null clears the rule. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  attachmentRequiredOverDays?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

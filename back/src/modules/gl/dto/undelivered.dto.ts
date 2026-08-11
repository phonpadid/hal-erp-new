import { IsDateString, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination';

/**
 * Filter for the undelivered-postings read. The window bounds `last_attempt_at` rather than any
 * accounting date: what a period close needs to know is whether anything was still being attempted
 * for that stretch of time, and a posting that has never been attempted has no accounting date yet.
 */
export class UndeliveredQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { AttendanceDirection, CorrectionKind } from '../../../common/enums';

/**
 * The shape rules are expressed as conditional validation rather than three separate DTOs, so the
 * error a requester sees names the field that is wrong instead of rejecting the whole request.
 * The same rules are checked again in the service (a target must also belong to the right person)
 * and once more as a database constraint, because a request the system cannot act on must not be
 * storable by any route.
 */
export class CreateTimeCorrectionDto {
  @IsUUID()
  documentId!: string;

  @IsUUID()
  employeeId!: string;

  /** The SHIFT day being corrected — what a person means by "my Tuesday is wrong". */
  @IsDateString()
  shiftDate!: string;

  @IsEnum(CorrectionKind)
  kind!: CorrectionKind;

  /** Required for CHANGE and REMOVE: there is a punch to supersede. Forbidden for ADD. */
  @ValidateIf((o: CreateTimeCorrectionDto) => o.kind !== CorrectionKind.ADD)
  @IsUUID()
  @ValidateIf((o: CreateTimeCorrectionDto) => o.kind === CorrectionKind.ADD)
  @IsOptional()
  targetEventId?: string;

  /** Required for ADD and CHANGE: there is a time to record. Forbidden for REMOVE. */
  @ValidateIf((o: CreateTimeCorrectionDto) => o.kind !== CorrectionKind.REMOVE)
  @IsDateString()
  @ValidateIf((o: CreateTimeCorrectionDto) => o.kind === CorrectionKind.REMOVE)
  @IsOptional()
  requestedAt?: string;

  @ValidateIf((o: CreateTimeCorrectionDto) => o.kind !== CorrectionKind.REMOVE)
  @IsEnum(AttendanceDirection)
  @ValidateIf((o: CreateTimeCorrectionDto) => o.kind === CorrectionKind.REMOVE)
  @IsOptional()
  requestedDirection?: AttendanceDirection;

  /** Always required. A correction to the record of what happened has to say why. */
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}

export class SetCorrectionWindowDto {
  @IsInt()
  @Min(0)
  correctionWindowDays!: number;
}

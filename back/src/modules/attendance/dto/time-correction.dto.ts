import { timeCorrectionCreateSchema } from '@erp/shared';
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
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import type { TimeCorrectionCreateInput } from '@erp/shared';

/**
 * The shape rules — which columns each kind requires — are refinements on the SHARED schema, so
 * the form names the field that is wrong instead of the server rejecting the whole request. They
 * are checked again in the service (a target must also belong to the right person) and once more
 * as a database constraint, because a request the system cannot act on must not be storable by any
 * route.
 */
export type CreateTimeCorrectionDto = TimeCorrectionCreateInput;
export const CreateTimeCorrectionValidationPipe = new ZodValidationPipe(timeCorrectionCreateSchema);

export class SetCorrectionWindowDto {
  @IsInt()
  @Min(0)
  correctionWindowDays!: number;
}

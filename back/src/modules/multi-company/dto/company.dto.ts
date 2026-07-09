import { companyCreateSchema } from '@erp/shared';
import { IsBoolean, IsOptional, IsString, Length, MaxLength, ValidateIf } from 'class-validator';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import type { CompanyCreateInput } from '@erp/shared';

// Company create reuses the shared Zod schema — one source of truth with the UI form.
export type CreateCompanyDto = CompanyCreateInput;
export const CreateCompanyValidationPipe = new ZodValidationPipe(companyCreateSchema);

// Update uses class-validator (no shared schema needed yet); all fields optional.
export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  nameTh?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  nameEn?: string;

  // Optional; when a non-empty value is given it must be 13 digits. '' clears the tax ID.
  @IsOptional()
  @IsString()
  @ValidateIf((o) => o.taxId !== '')
  @Length(13, 13)
  taxId?: string;

  @IsOptional()
  @IsString()
  @Length(5, 5)
  branchCode?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  baseCurrency?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateVendorBankAccountDto {
  @IsString()
  @MaxLength(255)
  bankCode!: string;

  // A string, always: an account number identifies, it does not measure. As a number its leading
  // zeros vanish and a long one loses precision.
  @IsString()
  @MaxLength(255)
  accountNo!: string;

  @IsString()
  @MaxLength(255)
  accountName!: string;

  // ISO 4217 code — `currency`'s primary key is the code itself, not a surrogate id.
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  // Omit to let the vendor's first account become primary automatically; a vendor with accounts
  // but no primary would leave every payee defaulting to nothing.
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdateVendorBankAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  bankCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  accountNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  accountName?: string;

  // null clears the account's currency.
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string | null;
}

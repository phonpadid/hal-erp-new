import { IsDateString, IsNotEmpty, IsString, IsUUID, Length, MaxLength } from 'class-validator';

export class CreateBankAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  bankName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  accountNo!: string;

  @IsString()
  @Length(3, 3)
  currencyCode!: string;

  /** The GL account whose balance represents this bank account. Must belong to the same company. */
  @IsUUID()
  glAccountId!: string;
}

export class ConfirmClearedDto {
  /** The day the BANK says the money moved — routinely not the day finance recorded the payment. */
  @IsDateString()
  clearedOn!: string;
}

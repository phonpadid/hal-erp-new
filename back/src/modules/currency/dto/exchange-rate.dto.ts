import {
  IsDateString,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';

export class CreateExchangeRateDto {
  @IsString()
  @Length(3, 3)
  fromCurrency!: string;

  @IsString()
  @Length(3, 3)
  toCurrency!: string;

  // DECIMAL carried as a string — never a JS number.
  @IsNumberString()
  rate!: string;

  @IsDateString()
  rateDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  rateType?: string;

  // Present → per-company override; absent → group-wide rate.
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  source?: string;
}

export class ResolveRateQueryDto {
  @IsString()
  @Length(3, 3)
  from!: string;

  @IsString()
  @Length(3, 3)
  to!: string;

  @IsDateString()
  asOf!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  rateType?: string;
}

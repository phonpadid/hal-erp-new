import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateVendorDto {
  @IsString()
  @MaxLength(255)
  vendorCode!: string;

  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(13, 13)
  taxId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  contactPhone?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  paymentTermDays?: number;
}

export class UpdateVendorDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(13, 13)
  taxId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  contactPhone?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  paymentTermDays?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Per-company enablement options: payment-term days overriding the group vendor's terms. */
export class EnableVendorDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  paymentTermDays?: number;
}

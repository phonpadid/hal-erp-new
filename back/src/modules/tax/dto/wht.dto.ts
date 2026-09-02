import { ArrayMinSize, IsArray, IsDateString, IsOptional, IsUUID } from 'class-validator';

export class CertifyWhtDto {
  /** Defaults to today. The date the payee's certificate bears. */
  @IsOptional()
  @IsDateString()
  issuedOn?: string;
}

export class RemitWhtDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  certificateIds!: string[];

  @IsDateString()
  remittedOn!: string;

  /**
   * The remittance's identity, optional. Supply one and a retried request resolves to the entry
   * already posted rather than a second one — the same contract the journal voucher offers.
   */
  @IsOptional()
  @IsUUID()
  remittanceId?: string;
}

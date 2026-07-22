import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DocStatus } from '../../../common/enums';
import { PaginationQueryDto } from '../../../common/pagination/pagination';

export class FieldValueInput {
  @IsUUID()
  formFieldId!: string;

  @IsOptional()
  @IsString()
  value?: string;
}

export class DocumentLineInput {
  @IsInt()
  @Min(1)
  lineNo!: number;

  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsString()
  @MaxLength(255)
  description!: string;

  @IsNumberString()
  qty!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  unit?: string;

  @IsNumberString()
  unitPrice!: string;

  @IsNumberString()
  lineAmount!: string;

  // Explicit budget selection — the fallback for an item-less line on a budget-controlled
  // type. For an item-backed line the budget is resolved server-side from the item's GL, so
  // this is ignored there. There is no client `glAccount`: the GL is always derived from the
  // item or the chosen budget, never typed by the requester (invariant 7).
  @IsOptional()
  @IsUUID()
  budgetId?: string;

  // VAT tax code for the line (computed into tax at submit).
  @IsOptional()
  @IsUUID()
  taxCodeId?: string;
}

export class CreateDocumentDto {
  @IsUUID()
  documentTypeId!: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsUUID()
  vendorId?: string;

  // Where the money lands. Required at submit when the type's requires_payee is set; must be an
  // active account of `vendorId`. Chosen here rather than at payment time so the destination
  // travels the same approval steps as the amount.
  @IsOptional()
  @IsUUID()
  vendorBankAccountId?: string;

  // Source of a stock movement. Required at submit when the type's requires_warehouse is set.
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  // Destination, for a TRANSFER_STOCK type. Must be a warehouse of the same company.
  @IsOptional()
  @IsUUID()
  destWarehouseId?: string;

  @IsOptional()
  @IsUUID()
  relatedEmployeeId?: string;

  @IsOptional()
  @IsUUID()
  refDocumentId?: string;

  @IsOptional()
  @IsNumberString()
  totalAmount?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FieldValueInput)
  fieldValues?: FieldValueInput[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DocumentLineInput)
  lines?: DocumentLineInput[];
}

export class QuotaReservationInput {
  @IsUUID()
  quotaId!: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsNumberString()
  qty!: string;

  @IsOptional()
  @IsInt()
  year?: number;
}

export class SubmitDocumentDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotaReservationInput)
  quotaReservations?: QuotaReservationInput[];
}

export class CreateFromDto {
  @IsUUID()
  documentTypeId!: string;
}

/**
 * Optional filters for the document list, applied server-side within the active-company
 * scope (see document-engine "Filtered Document Listing"). Amount bounds are decimal
 * strings (`@IsNumberString`) and are never coerced to a JS number. `status` accepts a
 * repeated query param or a comma-separated string.
 */
export class DocumentListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.split(',').map((s) => s.trim()).filter(Boolean)
      : value,
  )
  @IsArray()
  @IsEnum(DocStatus, { each: true })
  status?: DocStatus[];

  @IsOptional()
  @IsUUID()
  documentTypeId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  docNo?: string;

  @IsOptional()
  @IsNumberString()
  minAmount?: string;

  @IsOptional()
  @IsNumberString()
  maxAmount?: string;
}

export class ReceiveLineDto {
  @IsUUID()
  lineId!: string;

  // Quantity received now (added to received_qty); decimal string, never a JS number.
  @IsNumberString()
  qty!: string;
}

export class ReceiveDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lines!: ReceiveLineDto[];

  /**
   * Where the goods physically land. Required once the company runs warehouses; optional so a
   * company that has not adopted inventory keeps receiving exactly as before. Stock is written
   * only for lines whose item is `is_stock_tracked`.
   */
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}


/** Re-point a DRAFT document's payee. */
export class SetPayeeDto {
  // null clears the payee.
  @IsOptional()
  @IsUUID()
  vendorBankAccountId?: string | null;
}

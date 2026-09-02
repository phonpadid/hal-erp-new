import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
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
  ValidateIf,
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

  /**
   * The external system this document comes from, and its own identifier for the thing.
   *
   * Optional, and validated as a pair: `ValidateIf` fires on both as soon as either is present, so
   * one without the other fails rather than being silently dropped — a half-supplied key would
   * read as idempotent while protecting nothing. Together with the active company they are unique,
   * so a retried create returns the document it already made instead of a second one.
   */
  @ValidateIf((o: CreateDocumentDto) => o.sourceType !== undefined || o.sourceId !== undefined)
  @IsString()
  @Length(1, 255)
  sourceType?: string;

  @ValidateIf((o: CreateDocumentDto) => o.sourceType !== undefined || o.sourceId !== undefined)
  @IsString()
  @Length(1, 255)
  sourceId?: string;

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

  // The SUPPLIER's tax invoice — not this system's docNo. Required at submit when the document
  // claims input VAT, because a claim has to name the invoice it is claiming against.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  vendorInvoiceNo?: string;

  @IsOptional()
  @IsDateString()
  vendorInvoiceDate?: string;

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

/**
 * Withdrawing one's own request. The remark is optional: a withdrawal is the author's second
 * thoughts, and refusing to record the act because no reason was typed would trade a complete audit
 * trail for a nagging one.
 */
export class CancelDocumentDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remark?: string;
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

  /**
   * Narrow to documents the caller raised. A FILTER, not a scope: what a reader is allowed to see
   * is settled by their `DOC_VIEW` grant and is not bypassable from here, and this only ever
   * narrows within it.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  mine?: boolean;

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

/**
 * Correct the selections a DRAFT document's TYPE asks for. DRAFT only, like the payee beside it.
 *
 * Every key is optional and every value is nullable, and the two mean DIFFERENT things: an ABSENT
 * key leaves the column alone, an explicit `null` clears it. `@IsOptional()` skips validation for
 * both, so the service distinguishes them with `in` rather than by truthiness — a type that loses
 * `requires_warehouse` must be able to have the warehouse taken back off its drafts, and that is
 * indistinguishable from "not mentioned" if null and absent collapse.
 *
 * The four travel together because they are chosen together on one wizard step, and because a
 * TRANSFER_STOCK document's two warehouses have to be checked as a pair — split across requests,
 * there would be a moment where the document names the same warehouse at both ends.
 */
export class SetSelectionsDto {
  @IsOptional()
  @IsUUID()
  warehouseId?: string | null;

  @IsOptional()
  @IsUUID()
  destWarehouseId?: string | null;

  @IsOptional()
  @IsUUID()
  relatedEmployeeId?: string | null;

  @IsOptional()
  @IsUUID()
  vendorId?: string | null;
}

/** The supplier's tax invoice, recorded on a draft. Both nullable: clearing them is a valid edit. */
export class SetVendorInvoiceDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  vendorInvoiceNo?: string | null;

  @IsOptional()
  @IsDateString()
  vendorInvoiceDate?: string | null;
}

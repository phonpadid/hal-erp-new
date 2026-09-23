import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * The documents finance is registering receipt of.
 *
 * Capped rather than unbounded: the screen ticks a page at a time, and each id costs its own
 * transaction and row lock. A request asking for ten thousand is not a week's intake — it is
 * either a mistake or someone using the endpoint as a bulk writer.
 */
export class ReceiveDocumentsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  documentIds!: string[];
}

/** Why a receipt was undone. Optional — an officer correcting their own misclick has nothing useful to write. */
export class ReverseIntakeDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}

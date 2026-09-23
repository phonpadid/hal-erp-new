import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  multipartOptions,
  validateUpload,
  type UploadedFile as MultipartFile,
} from '../../common/storage/upload';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { PaymentBatchService } from './payment-batch.service';
import { BuildBatchDto, ImportResultDto } from './dto/payment-batch.dto';
import { PaymentPermissions as P } from './permissions';

/** A bank result file is a few KB of text; anything near this is not one. */
const RESULT_FILE_MAX_SIZE_KB = 2 * 1024;

/**
 * Payment runs: build from the ready-to-pay queue, export a file for the bank, import its result.
 *
 * Reads need PAYMENT_BATCH_VIEW, every mutation PAYMENT_BATCH_MANAGE. Every route is company-scoped
 * in the service, so another company's batch is indistinguishable from one that does not exist.
 */
@Controller('payment-batches')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PaymentBatchController {
  constructor(private readonly batches: PaymentBatchService) {}

  @Get()
  @RequirePermissions(P.PAYMENT_BATCH_VIEW)
  list() {
    return this.batches.list();
  }

  @Get(':id')
  @RequirePermissions(P.PAYMENT_BATCH_VIEW)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.batches.get(id);
  }

  @Post()
  @RequirePermissions(P.PAYMENT_BATCH_MANAGE)
  build(@Body() dto: BuildBatchDto) {
    return this.batches.build(dto);
  }

  /**
   * Render (or re-download) the batch's bank file.
   *
   * A POST rather than a GET: the first call moves the batch to EXPORTED and stores the artifact,
   * so it is not a safe, repeatable read the way its name suggests.
   */
  @Post(':id/export')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(P.PAYMENT_BATCH_MANAGE)
  async export(@Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    const { bytes, fileName, contentType } = await this.batches.export(id);
    return new StreamableFile(bytes, { type: contentType, disposition: `attachment; filename="${fileName}"` });
  }

  /** Apply an already-parsed result — what the UI sends when finance ticks each line by hand. */
  @Post(':id/result')
  @HttpCode(200)
  @RequirePermissions(P.PAYMENT_BATCH_MANAGE)
  importResult(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ImportResultDto) {
    return this.batches.importResult(id, dto);
  }

  /**
   * Apply the bank's result FILE.
   *
   * `rates` is a JSON map of documentId → actual rate: the file says what the bank moved, not what
   * we book it at. Omitted rates fall back to each document's locked rate, so a base-currency run
   * needs none. Mime is not restricted — banks label CSV as text/plain, application/octet-stream,
   * and worse — but the parser refuses anything it cannot read with confidence, which is the real
   * guard.
   */
  @Post(':id/result-file')
  @HttpCode(200)
  @RequirePermissions(P.PAYMENT_BATCH_MANAGE)
  @UseInterceptors(FileInterceptor('file', multipartOptions(RESULT_FILE_MAX_SIZE_KB)))
  async importResultFile(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: MultipartFile | undefined,
    @Body('rates') rates?: string,
  ) {
    validateUpload(file, null, RESULT_FILE_MAX_SIZE_KB);
    let ratesByDocument: Record<string, string> = {};
    if (rates) {
      try {
        ratesByDocument = JSON.parse(rates) as Record<string, string>;
      } catch {
        throw new BadRequestException('rates must be a JSON object of documentId → rate');
      }
    }
    return this.batches.importResultFile(id, file.buffer.toString('utf8'), ratesByDocument);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(P.PAYMENT_BATCH_MANAGE)
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.batches.cancel(id);
  }
}

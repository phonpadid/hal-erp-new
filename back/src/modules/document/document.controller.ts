import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiKeyDenyGuard } from '../../auth/api-key-deny.guard';
import { JwtOrApiKeyGuard } from '../../auth/jwt-or-api-key.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { ATTACHMENT_MAX_SIZE_KB, AttachmentService } from './attachment.service';
import { uploadLimits, type UploadedFile as MultipartFile } from '../../common/storage/upload';
import { DocumentPdfService } from './document-pdf.service';
import { DocumentService } from './document.service';
import { DocumentSubmitService } from './document-submit.service';
import { MatchingService } from './matching.service';
import { ReceivingService } from './receiving.service';
import {
  CreateDocumentDto,
  CancelDocumentDto,
  CreateFromDto,
  DocumentLineInput,
  DocumentListQueryDto,
  FieldValueInput,
  ReceiveDto,
  SubmitDocumentDto,
  SetPayeeDto,
  SetVendorInvoiceDto,
} from './dto/document.dto';
import { DocumentPermissions as P } from './permissions';
import { PaymentPermissions as PayP } from '../payment-handoff/permissions';

@Controller('documents')
// Accepts a JWT or an API key. Keys may read + create/submit (subject to the bound user's
// permission codes); they are barred from approval endpoints on the ApprovalController.
@UseGuards(JwtOrApiKeyGuard, PermissionsGuard)
export class DocumentController {
  constructor(
    private readonly documents: DocumentService,
    private readonly submit: DocumentSubmitService,
    private readonly attachments: AttachmentService,
    private readonly receiving: ReceivingService,
    private readonly matchingSvc: MatchingService,
    private readonly pdf: DocumentPdfService,
  ) {}

  @Post()
  @RequirePermissions(P.DOC_CREATE)
  create(@Body() dto: CreateDocumentDto) {
    return this.documents.createDraft(dto);
  }

  // Create a draft from an approved predecessor (PR→PO, advance→clear). Literal 'from'
  // segment, declared before ':id' routes so it never collides with a UUID param.
  @Post('from/:refId')
  @RequirePermissions(P.DOC_CREATE)
  createFrom(@Param('refId', ParseUUIDPipe) refId: string, @Body() dto: CreateFromDto) {
    return this.documents.createFrom(refId, dto.documentTypeId);
  }

  // Goods receipt: accumulate received_qty on the document's lines.
  @Post(':id/receipts')
  @HttpCode(200)
  @RequirePermissions(P.DOC_RECEIVE)
  receive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReceiveDto) {
    return this.receiving.receive(id, dto);
  }

  // 3-way match result for a disbursement that references a PO (ordered vs received vs invoiced).
  @Get(':id/matching')
  @RequirePermissions(P.DOC_VIEW)
  matching(@Param('id', ParseUUIDPipe) id: string) {
    return this.matchingSvc.match(id);
  }

  @Get()
  @RequirePermissions(P.DOC_VIEW)
  list(@Query() q: DocumentListQueryDto) {
    return this.documents.list(q);
  }

  // Requester-facing creation metadata (before ':id' so paths don't collide).
  @Get('creatable-types')
  @RequirePermissions(P.DOC_CREATE)
  creatableTypes() {
    return this.documents.listCreatableTypes();
  }

  @Get('types/:id/form')
  @RequirePermissions(P.DOC_CREATE)
  formForType(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.formForType(id);
  }

  @Get(':id')
  @RequirePermissions(P.DOC_VIEW)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.get(id);
  }

  // Full detail: header + field values + lines + attachments + predecessor reference.
  @Get(':id/detail')
  @RequirePermissions(P.DOC_VIEW)
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.detail(id);
  }

  // Export the document + approval trail (with each flagged step's stamped signature) as a
  // streamed PDF. Same read guard + company scope as reading the document — if you may read
  // it you may export it; a cross-company id is not-found.
  @Get(':id/pdf')
  @RequirePermissions(P.DOC_VIEW)
  @Header('Content-Type', 'application/pdf')
  async exportPdf(@Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    const bytes = await this.pdf.render(id);
    return new StreamableFile(bytes, {
      type: 'application/pdf',
      disposition: `attachment; filename="${id}.pdf"`,
    });
  }

  @Put(':id/fields')
  @RequirePermissions(P.DOC_CREATE)
  @HttpCode(204)
  setFields(@Param('id', ParseUUIDPipe) id: string, @Body() values: FieldValueInput[]) {
    return this.documents.setFieldValues(id, values);
  }

  // The payee is DRAFT-only: the destination that passed the approval chain is the one that gets
  // paid, so redirecting an approved payment requires returning the document and re-approving it.
  @Patch(':id/payee')
  @RequirePermissions(P.DOC_CREATE)
  @HttpCode(204)
  setPayee(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPayeeDto) {
    return this.documents.setPayee(id, dto.vendorBankAccountId ?? null);
  }

  // DRAFT-only, like the payee: the invoice a document claims against is part of what the approvers
  // saw when they approved the amount.
  @Patch(':id/invoice')
  @RequirePermissions(P.DOC_CREATE)
  @HttpCode(204)
  setVendorInvoice(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetVendorInvoiceDto) {
    return this.documents.setVendorInvoice(
      id,
      dto.vendorInvoiceNo ?? null,
      dto.vendorInvoiceDate ?? null,
    );
  }

  @Put(':id/lines')
  @RequirePermissions(P.DOC_CREATE)
  @HttpCode(204)
  setLines(@Param('id', ParseUUIDPipe) id: string, @Body() lines: DocumentLineInput[]) {
    return this.documents.setLines(id, lines);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions(P.DOC_SUBMIT)
  submitDoc(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitDocumentDto) {
    return this.submit.submit(id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(P.DOC_CANCEL)
  async cancelDoc(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDocumentDto) {
    await this.submit.cancel(id, dto);
    return { ok: true };
  }

  // Upload attachment bytes (multipart) through the API; the backend writes them to storage.
  @Post(':id/attachments/upload')
  @RequirePermissions(P.DOC_CREATE)
  @UseInterceptors(FileInterceptor('file', { limits: uploadLimits(ATTACHMENT_MAX_SIZE_KB) }))
  attach(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: MultipartFile) {
    return this.attachments.upload(id, file);
  }

  @Get(':id/attachments')
  @RequirePermissions(P.DOC_VIEW)
  listAttachments(@Param('id', ParseUUIDPipe) id: string) {
    return this.attachments.list(id);
  }

  @Get(':id/attachments/:attId/download-url')
  @RequirePermissions(P.DOC_VIEW)
  downloadUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attId', ParseUUIDPipe) attId: string,
  ) {
    return this.attachments.downloadUrl(id, attId);
  }
}

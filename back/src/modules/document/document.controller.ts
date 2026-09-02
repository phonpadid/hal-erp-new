import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseArrayPipe,
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
  SetSelectionsDto,
  SetVendorInvoiceDto,
} from './dto/document.dto';
import { DocumentPermissions as P } from './permissions';
import { PaymentPermissions as PayP } from '../payment-handoff/permissions';

/**
 * A body that arrives as a top-level array is skipped by the global `ValidationPipe`: its metatype
 * is `Array`, which the pipe treats as a native type. So the element class has to be named here,
 * with the same whitelist and forbid-non-whitelisted settings `main.ts` applies to every other
 * body — the settings are spelled out rather than imported because this is the place they can be
 * checked against the global pipe.
 *
 * Both element classes are already fully decorated and are already enforced when they arrive nested
 * inside `CreateDocumentDto`. Nothing here adds a rule; it runs the ones that were being skipped.
 */
const arrayBody = (items: new () => object) =>
  new ParseArrayPipe({ items, whitelist: true, forbidNonWhitelisted: true });

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

  // Reader-facing: the types present in the list this caller can see, for the list's type
  // filter. DOC_VIEW, not DOC_CREATE — filtering a list is not authoring one.
  @Get('types')
  @RequirePermissions(P.DOC_VIEW)
  typesInView() {
    return this.documents.listTypesInView();
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
  setFields(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(arrayBody(FieldValueInput)) values: FieldValueInput[],
  ) {
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

  // DRAFT-only, like the payee and the invoice, and for the same reason: what the approvers approved
  // is what gets acted on. Its own route rather than a general update because there is no general
  // update — fields, lines, payee and invoice each have theirs. All four selections travel together
  // because they are chosen on one wizard step and because a transfer's two warehouses have to be
  // checked as a pair; split across requests there would be a moment naming the same warehouse at
  // both ends. Without this route the four were write-once at creation, and a draft that lacked one
  // its type requires could be neither submitted nor repaired.
  @Patch(':id/selections')
  @RequirePermissions(P.DOC_CREATE)
  @HttpCode(204)
  setSelections(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetSelectionsDto) {
    return this.documents.setSelections(id, dto);
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
  setLines(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(arrayBody(DocumentLineInput)) lines: DocumentLineInput[],
  ) {
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

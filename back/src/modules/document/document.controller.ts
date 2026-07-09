import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { AttachmentService } from './attachment.service';
import { DocumentPdfService } from './document-pdf.service';
import { DocumentService } from './document.service';
import { DocumentSubmitService } from './document-submit.service';
import { MatchingService } from './matching.service';
import { ReceivingService } from './receiving.service';
import {
  CreateDocumentDto,
  CreateFromDto,
  DocumentLineInput,
  DocumentListQueryDto,
  FieldValueInput,
  PresignUploadDto,
  ReceiveDto,
  RegisterAttachmentDto,
  SubmitDocumentDto,
} from './dto/document.dto';
import { DocumentPermissions as P } from './permissions';

@Controller('documents')
@UseGuards(JwtAuthGuard, PermissionsGuard)
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
  async cancelDoc(@Param('id', ParseUUIDPipe) id: string) {
    await this.submit.cancel(id);
    return { ok: true };
  }

  // Step 1: presigned PUT URL so the browser uploads bytes directly to S3/MinIO.
  @Post(':id/attachments/presign-upload')
  @RequirePermissions(P.DOC_CREATE)
  presignUpload(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PresignUploadDto) {
    return this.attachments.presignUpload(id, dto);
  }

  // Step 3: register the uploaded object's metadata (path = the returned object key).
  @Post(':id/attachments')
  @RequirePermissions(P.DOC_CREATE)
  attach(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RegisterAttachmentDto) {
    return this.attachments.register(id, dto);
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

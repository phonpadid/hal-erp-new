import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentTypeService } from './document-type.service';
import { RefChainService } from './ref-chain.service';
import {
  CreateDeptDocTypeDto,
  CreateDocumentTypeDto,
  CreateFormFieldDto,
  CreateFormTemplateDto,
  CreateRefPairingDto,
  ListDocumentTypesQueryDto,
  ListFormTemplatesQueryDto,
  ListRefPairingsQueryDto,
  UpdateDeptDocTypeDto,
  UpdateDocumentTypeDto,
  UpdateFormFieldDto,
} from './dto/config.dto';
import { FormTemplateService } from './form-template.service';
import { DocumentPermissions as P } from './permissions';

@Controller('document-config')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(P.DOC_CONFIG_MANAGE)
export class DocumentConfigController {
  constructor(
    private readonly docTypes: DocumentTypeService,
    private readonly templates: FormTemplateService,
    private readonly mappings: DeptDocTypeService,
    private readonly refChain: RefChainService,
  ) {}

  @Post('document-types')
  createType(@Body() dto: CreateDocumentTypeDto) {
    return this.docTypes.create(dto);
  }

  @Get('document-types')
  listTypes(@Query() q: ListDocumentTypesQueryDto) {
    return this.docTypes.list(q, q.includeInactive ?? false);
  }

  @Patch('document-types/:id')
  updateType(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDocumentTypeDto) {
    return this.docTypes.update(id, dto);
  }

  @Get('form-templates')
  listTemplates(@Query() q: ListFormTemplatesQueryDto) {
    return this.templates.listForType(q.documentTypeId, q);
  }

  @Post('form-templates')
  createTemplate(@Body() dto: CreateFormTemplateDto) {
    return this.templates.createTemplate(dto);
  }

  @Post('form-templates/:id/publish')
  publishTemplate(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.publish(id);
  }

  @Post('form-templates/:id/retire')
  retireTemplate(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.retire(id);
  }

  @Get('form-templates/:id/fields')
  listFields(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.listFields(id);
  }

  @Post('form-fields')
  addField(@Body() dto: CreateFormFieldDto) {
    return this.templates.addField(dto);
  }

  @Patch('form-fields/:id')
  updateField(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFormFieldDto) {
    return this.templates.updateField(id, dto);
  }

  @Get('dept-doc-types')
  listMappings(@Query() q: PaginationQueryDto) {
    return this.mappings.listForCompany(q);
  }

  @Post('dept-doc-types')
  createMapping(@Body() dto: CreateDeptDocTypeDto) {
    return this.mappings.create(dto);
  }

  @Patch('dept-doc-types/:id')
  updateMapping(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDeptDocTypeDto) {
    return this.mappings.update(id, dto);
  }

  // Reference-chain pairings (document_type_ref): the successor/predecessor types configured
  // for a document type. Same DOC_CONFIG_MANAGE guard and company scope as the rest of config.
  @Get('ref-pairings')
  listRefPairings(@Query() q: ListRefPairingsQueryDto) {
    return this.refChain.listForType(q.documentTypeId);
  }

  @Post('ref-pairings')
  addRefPairing(@Body() dto: CreateRefPairingDto) {
    return this.refChain.addPairing(dto);
  }

  @Delete('ref-pairings/:id')
  @HttpCode(204)
  removeRefPairing(@Param('id', ParseUUIDPipe) id: string) {
    return this.refChain.removePairing(id);
  }
}

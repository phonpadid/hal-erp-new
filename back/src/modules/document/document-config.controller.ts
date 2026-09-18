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
import { PaginationQueryDto, SearchablePaginationQueryDto } from '../../common/pagination/pagination';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentCategoryService } from './document-category.service';
import { DocumentTypeService } from './document-type.service';
import { RefChainService } from './ref-chain.service';
import {
  CreateDeptDocTypeDto,
  CreateDocumentCategoryDto,
  CreateDocumentTypeDto,
  CreateFormFieldDto,
  CreateFormTemplateDto,
  CreateRefPairingDto,
  DeptDocTypeListQueryDto,
  ListDocumentCategoriesQueryDto,
  ListDocumentTypesQueryDto,
  ListFormTemplatesQueryDto,
  ListRefPairingsQueryDto,
  UpdateDeptDocTypeDto,
  UpdateDocumentCategoryDto,
  UpdateDocumentTypeDto,
  UpdateFormFieldDto,
  UpdateRefPairingDto,
} from './dto/config.dto';
import { FormTemplateService } from './form-template.service';
import { DocumentPermissions as P } from './permissions';

@Controller('document-config')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(P.DOC_CONFIG_MANAGE)
export class DocumentConfigController {
  constructor(
    private readonly docTypes: DocumentTypeService,
    private readonly categories: DocumentCategoryService,
    private readonly templates: FormTemplateService,
    private readonly mappings: DeptDocTypeService,
    private readonly refChain: RefChainService,
  ) {}

  // Document categories (document_category) — company-scoped config feeding the document-type
  // category Select. Same DOC_CONFIG_MANAGE guard and company scope as the rest of config.
  @Get('document-categories')
  listCategories(@Query() q: ListDocumentCategoriesQueryDto) {
    return this.categories.list(q, q.includeInactive ?? false);
  }

  @Post('document-categories')
  createCategory(@Body() dto: CreateDocumentCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch('document-categories/:id')
  updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDocumentCategoryDto) {
    return this.categories.update(id, dto);
  }

  @Delete('document-categories/:id')
  @HttpCode(204)
  removeCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.categories.remove(id);
  }

  @Post('document-types')
  createType(@Body() dto: CreateDocumentTypeDto) {
    return this.docTypes.create(dto);
  }

  @Get('document-types')
  listTypes(@Query() q: ListDocumentTypesQueryDto) {
    return this.docTypes.list(q, q.includeInactive ?? false);
  }

  // The codes a type's read gate (`view_permission_code`) may name. Here rather than under
  // /rbac so the document-config administrator can fill the form without RBAC_MANAGE.
  @Get('permission-codes')
  listPermissionCodes() {
    return this.docTypes.listPermissionCodes();
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
  listMappings(@Query() q: DeptDocTypeListQueryDto) {
    return this.mappings.listForCompany(q);
  }

  /**
   * The departments that hold at least one mapping — the option list for the mapping filter.
   *
   * Deliberately NOT `GET /departments`, which requires `DEPARTMENT_VIEW`: a `DOC_CONFIG_MANAGE`
   * holder need not have it, so sourcing the dropdown there would hand an empty filter to exactly
   * the administrator it exists for. The same reasoning `BudgetService.listFilterDepartments`
   * already records one module over. Only departments that HOLD a mapping, so the filter can never
   * offer an option that yields nothing.
   */
  @Get('dept-doc-types/departments')
  listMappingDepartments() {
    return this.mappings.listFilterDepartments();
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

  @Patch('ref-pairings/:id')
  updateRefPairing(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRefPairingDto) {
    return this.refChain.setAutoCreate(id, dto);
  }

  @Delete('ref-pairings/:id')
  @HttpCode(204)
  removeRefPairing(@Param('id', ParseUUIDPipe) id: string) {
    return this.refChain.removePairing(id);
  }
}

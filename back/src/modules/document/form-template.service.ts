import { EntityManager } from '@mikro-orm/postgresql';
import { HttpStatus, Injectable } from '@nestjs/common';
import { explained } from '../../common/errors/error-code';
import { FIELD_TYPES } from '@erp/shared';
import {
  pageParams,
  type Paginated,
  type PaginationQueryDto,
} from '../../common/pagination/pagination';
import { DocumentType, FormField, FormTemplate } from './document.entities';
import type {
  CreateFormFieldDto,
  CreateFormTemplateDto,
  UpdateFormFieldDto,
} from './dto/config.dto';

const FIELD_TYPE_SET = new Set<string>(FIELD_TYPES);

/** Versioned form templates + fields. A document pins its form_template_id forever. */
@Injectable()
export class FormTemplateService {
  constructor(private readonly em: EntityManager) {}

  /** Create a template; version defaults to the next version for the document type. */
  async createTemplate(dto: CreateFormTemplateDto): Promise<FormTemplate> {
    let version = dto.version;
    if (version === undefined) {
      const latest = await this.em.find(
        FormTemplate,
        { documentType: dto.documentTypeId },
        { orderBy: { version: 'DESC' }, limit: 1 },
      );
      version = (latest[0]?.version ?? 0) + 1;
    }
    const template = this.em.create(FormTemplate, {
      documentType: this.em.getReference(DocumentType, dto.documentTypeId),
      version,
      status: 'DRAFT',
      createdAt: new Date(),
    });
    await this.em.persistAndFlush(template);
    return template;
  }

  async addField(dto: CreateFormFieldDto): Promise<FormField> {
    // A template is mutable only while DRAFT — published/retired forms are frozen so
    // documents pinned to them keep rendering exactly what was published (invariant: old
    // documents keep their form version). Further changes go to a new version.
    const template = await this.requireTemplate(dto.formTemplateId);
    if (template.status !== 'DRAFT') {
      throw explained(
        'config.form.notDraft',
        { status: template.status },
        `Form template is ${template.status}; create a new version to change fields`,
        HttpStatus.CONFLICT,
      );
    }
    if (!FIELD_TYPE_SET.has(dto.fieldType)) {
      throw explained('config.form.unknownFieldType', { fieldType: dto.fieldType }, `Unknown field type '${dto.fieldType}'`);
    }
    if (dto.fieldType === 'dropdown') this.assertDropdownOptions(dto.optionsJson);
    const field = this.em.create(FormField, {
      formTemplate: this.em.getReference(FormTemplate, dto.formTemplateId),
      fieldName: dto.fieldName,
      fieldLabel: dto.fieldLabel,
      fieldType: dto.fieldType,
      isRequired: dto.isRequired ?? false,
      sortOrder: dto.sortOrder ?? 0,
      optionsJson: dto.optionsJson,
      conditionJson: dto.conditionJson,
    });
    await this.em.persistAndFlush(field);
    return field;
  }

  /** Update a field on a DRAFT template (label, required, order, options, condition). */
  async updateField(fieldId: string, dto: UpdateFormFieldDto): Promise<FormField> {
    const field = await this.em.findOne(FormField, { id: fieldId }, { populate: ['formTemplate'] });
    if (!field) throw explained('config.notFound.field', {}, 'Form field not found', HttpStatus.NOT_FOUND);
    if (field.formTemplate.status !== 'DRAFT') {
      throw explained(
        'config.form.notDraft',
        { status: field.formTemplate.status },
        `Form template is ${field.formTemplate.status}; create a new version to change fields`,
        HttpStatus.CONFLICT,
      );
    }
    if (dto.fieldType !== undefined) {
      if (!FIELD_TYPE_SET.has(dto.fieldType)) {
        throw explained('config.form.unknownFieldType', { fieldType: dto.fieldType }, `Unknown field type '${dto.fieldType}'`);
      }
      field.fieldType = dto.fieldType;
    }
    if (dto.fieldLabel !== undefined) field.fieldLabel = dto.fieldLabel;
    if (dto.isRequired !== undefined) field.isRequired = dto.isRequired;
    if (dto.sortOrder !== undefined) field.sortOrder = dto.sortOrder;
    if (dto.optionsJson !== undefined) field.optionsJson = dto.optionsJson;
    if (dto.conditionJson !== undefined) field.conditionJson = dto.conditionJson;
    if ((field.fieldType ?? '') === 'dropdown') this.assertDropdownOptions(field.optionsJson);
    await this.em.flush();
    return field;
  }

  /** DRAFT → PUBLISHED. Only a draft can be published. */
  async publish(templateId: string): Promise<FormTemplate> {
    const template = await this.requireTemplate(templateId);
    if (template.status !== 'DRAFT') {
      throw explained('config.form.notDraft', { status: template.status }, `Form template is ${template.status}, not DRAFT`, HttpStatus.CONFLICT);
    }
    template.status = 'PUBLISHED';
    await this.em.flush();
    return template;
  }

  /** PUBLISHED → RETIRED. A retired template can no longer back a new mapping. */
  async retire(templateId: string): Promise<FormTemplate> {
    const template = await this.requireTemplate(templateId);
    if (template.status !== 'PUBLISHED') {
      throw explained('config.form.notPublished', { status: template.status }, `Form template is ${template.status}, not PUBLISHED`, HttpStatus.CONFLICT);
    }
    template.status = 'RETIRED';
    await this.em.flush();
    return template;
  }

  private async requireTemplate(templateId: string): Promise<FormTemplate> {
    const template = await this.em.findOne(FormTemplate, { id: templateId });
    if (!template) throw explained('config.notFound.template', {}, 'Form template not found', HttpStatus.NOT_FOUND);
    return template;
  }

  /** A dropdown's options must be a non-empty JSON array of choices. */
  private assertDropdownOptions(optionsJson?: string): void {
    if (!optionsJson) throw explained('config.form.dropdownNeedsOptions', {}, 'A dropdown field requires options');
    let parsed: unknown;
    try {
      parsed = JSON.parse(optionsJson);
    } catch {
      throw explained('config.form.optionsNotJson', {}, 'Dropdown options must be valid JSON');
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw explained('config.form.optionsEmpty', {}, 'Dropdown options must be a non-empty array');
    }
  }

  listFields(templateId: string): Promise<FormField[]> {
    return this.em.find(
      FormField,
      { formTemplate: templateId },
      { orderBy: { sortOrder: 'ASC' } },
    );
  }

  /** A document type's form templates with their field counts (for the config UI). */
  async listForType(
    documentTypeId: string,
    q: PaginationQueryDto = {},
  ): Promise<Paginated<{ id: string; version: number; status: string; fieldCount: number }>> {
    const { page, limit, offset } = pageParams(q);
    const [templates, total] = await this.em.findAndCount(
      FormTemplate,
      { documentType: documentTypeId },
      { orderBy: { version: 'DESC' }, offset, limit },
    );
    const counts = await Promise.all(
      templates.map((t) => this.em.count(FormField, { formTemplate: t.id })),
    );
    const items = templates.map((t, i) => ({
      id: t.id,
      version: t.version,
      status: t.status,
      fieldCount: counts[i],
    }));
    return { items, total, page, limit };
  }
}

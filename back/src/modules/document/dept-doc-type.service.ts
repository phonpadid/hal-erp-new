import { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import {
  pageParams,
  type Paginated,
  type PaginationQueryDto,
} from '../../common/pagination/pagination';
import { Department } from '../multi-company/multi-company.entities';
import { Workflow } from '../approval/approval.entities';
import { DeptDocType, DocumentType, FormTemplate } from './document.entities';
import { assertReservationCanBeSettled } from './ref-chain.config';
import type { CreateDeptDocTypeDto, UpdateDeptDocTypeDto } from './dto/config.dto';

const FILTER_OFF = { filters: { company: false } } as const;

/** dept_doc_type: which document type a department uses, with its form + workflow. */
@Injectable()
export class DeptDocTypeService {
  constructor(private readonly em: EntityManager) {}

  /**
   * A form template may back a mapping only if it exists, belongs to the given document type,
   * and is not RETIRED. Used by both create and update (on update the document type is fixed).
   */
  private async assertTemplateMappable(templateId: string, documentTypeId: string): Promise<void> {
    const template = await this.em.findOne(FormTemplate, { id: templateId }, FILTER_OFF);
    if (!template) throw new BadRequestException(`Form template ${templateId} not found`);
    if (template.documentType.id !== documentTypeId) {
      throw new BadRequestException('Form template does not belong to the selected document type');
    }
    if (template.status === 'RETIRED') {
      throw new BadRequestException('A retired form template cannot be mapped');
    }
  }

  async create(dto: CreateDeptDocTypeDto): Promise<DeptDocType> {
    // A department may only map a document type of its own company (invariant 1): both the
    // department and the type carry a company_id, and they must match.
    const dept = await this.em.findOne(Department, { id: dto.departmentId }, FILTER_OFF);
    const type = await this.em.findOne(DocumentType, { id: dto.documentTypeId }, FILTER_OFF);
    if (!dept) throw new BadRequestException(`Department ${dto.departmentId} not found`);
    if (!type) throw new BadRequestException(`Document type ${dto.documentTypeId} not found`);
    if (dept.company.id !== type.company.id) {
      throw new BadRequestException('Department and document type belong to different companies');
    }
    await this.assertTemplateMappable(dto.formTemplateId, dto.documentTypeId);
    // Mapping is where a document type becomes raisable — listCreatableTypes reads dept_doc_type
    // and createDraft resolves through it — so it is the first moment a reservation is possible,
    // and the moment the type must have somewhere for that reservation to go. It cannot be checked
    // at the type's creation: a pairing names two existing types, so a new type has no edges yet
    // and a type settled further down its chain could never be configured at all (D6).
    await assertReservationCanBeSettled(this.em, type.company.id, type);
    // A (department, document type) pair maps to exactly one workflow+form. Detect the
    // duplicate explicitly so the caller gets a clear 409 instead of an opaque 500 from the
    // @Unique constraint. The DB constraint remains the last line of defense against a race.
    const existing = await this.em.findOne(
      DeptDocType,
      { department: dto.departmentId, documentType: dto.documentTypeId },
      FILTER_OFF,
    );
    if (existing) {
      throw new ConflictException(
        'This department is already mapped to that document type; edit the existing mapping instead.',
      );
    }
    const mapping = this.em.create(DeptDocType, {
      department: this.em.getReference(Department, dto.departmentId),
      documentType: this.em.getReference(DocumentType, dto.documentTypeId),
      formTemplate: this.em.getReference(FormTemplate, dto.formTemplateId),
      workflow: this.em.getReference(Workflow, dto.workflowId),
      isActive: true,
    });
    try {
      await this.em.persistAndFlush(mapping);
    } catch (e) {
      // Concurrent create of the same pair loses the unique-constraint race — still a 409.
      if (e instanceof UniqueConstraintViolationException) {
        throw new ConflictException(
          'This department is already mapped to that document type; edit the existing mapping instead.',
        );
      }
      throw e;
    }
    return mapping;
  }

  /**
   * Update an existing mapping's workflow / form template / active state, scoped to the active
   * company. The (department, document type) identity is fixed. Repointing affects only
   * documents created afterward — existing documents keep their own form_template_id/workflow_id.
   */
  async update(id: string, dto: UpdateDeptDocTypeDto): Promise<DeptDocType> {
    const companyId = RequestContext.companyId()!;
    const mapping = await this.em.findOne(
      DeptDocType,
      { id, department: { company: companyId } },
      { ...FILTER_OFF, populate: ['documentType'] },
    );
    if (!mapping) throw new NotFoundException(`Mapping ${id} not found`);

    if (dto.formTemplateId !== undefined) {
      await this.assertTemplateMappable(dto.formTemplateId, mapping.documentType.id);
      mapping.formTemplate = this.em.getReference(FormTemplate, dto.formTemplateId);
    }
    if (dto.workflowId !== undefined) {
      mapping.workflow = this.em.getReference(Workflow, dto.workflowId);
    }
    if (dto.isActive !== undefined) {
      mapping.isActive = dto.isActive;
    }
    await this.em.flush();
    return mapping;
  }

  /** The active company's department-document mappings, with resolved names. */
  async listForCompany(q: PaginationQueryDto = {}): Promise<
    Paginated<{
      id: string; departmentId: string; departmentName: string;
      documentTypeId: string; documentTypeCode: string;
      formTemplateId: string; templateVersion: number;
      workflowId: string; workflowName: string; isActive: boolean;
    }>
  > {
    const companyId = RequestContext.companyId()!;
    const { page, limit, offset } = pageParams(q);
    const [rows, total] = await this.em.findAndCount(
      DeptDocType,
      { department: { company: companyId } },
      { offset, limit, ...FILTER_OFF },
    );
    // Batch-resolve names by id (robust vs. per-row relation loads).
    const depts = new Map(
      (await this.em.find(Department, { company: companyId }, FILTER_OFF)).map((d) => [d.id, d.name]),
    );
    const typeIds = [...new Set(rows.map((r) => r.documentType.id))];
    const tmplIds = [...new Set(rows.map((r) => r.formTemplate.id))];
    const wfIds = [...new Set(rows.map((r) => r.workflow.id))];
    const types = new Map(
      (typeIds.length ? await this.em.find(DocumentType, { id: { $in: typeIds } }, FILTER_OFF) : []).map((t) => [t.id, t.code]),
    );
    const tmpls = new Map(
      (tmplIds.length ? await this.em.find(FormTemplate, { id: { $in: tmplIds } }, FILTER_OFF) : []).map((t) => [t.id, t.version]),
    );
    const wfs = new Map(
      (wfIds.length ? await this.em.find(Workflow, { id: { $in: wfIds } }, FILTER_OFF) : []).map((w) => [w.id, w.name]),
    );
    const items = rows.map((r) => ({
      id: r.id,
      departmentId: r.department.id, departmentName: depts.get(r.department.id) ?? '',
      documentTypeId: r.documentType.id, documentTypeCode: types.get(r.documentType.id) ?? '',
      formTemplateId: r.formTemplate.id, templateVersion: tmpls.get(r.formTemplate.id) ?? 0,
      workflowId: r.workflow.id, workflowName: wfs.get(r.workflow.id) ?? '',
      isActive: r.isActive,
    }));
    return { items, total, page, limit };
  }

  /** Resolve the active mapping for (department, document type) or reject. */
  async resolve(departmentId: string, documentTypeId: string): Promise<DeptDocType> {
    const mapping = await this.em.findOne(
      DeptDocType,
      { department: departmentId, documentType: documentTypeId, isActive: true },
      { populate: ['formTemplate', 'workflow'], ...FILTER_OFF },
    );
    if (!mapping) {
      throw new BadRequestException(
        `Document type ${documentTypeId} is not enabled for department ${departmentId}`,
      );
    }
    return mapping;
  }
}

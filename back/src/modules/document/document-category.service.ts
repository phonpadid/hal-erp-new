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
  paginate,
  type Paginated,
  type PaginationQueryDto,
} from '../../common/pagination/pagination';
import { Company } from '../multi-company/multi-company.entities';
import { DocumentCategory, DocumentType } from './document.entities';
import type { CreateDocumentCategoryDto, UpdateDocumentCategoryDto } from './dto/config.dto';

/**
 * document_category registry — document-type categories as company-scoped config (invariant 1 +
 * config over code), replacing the former `doc_category` enum. Like DocumentType it is not a
 * CompanyScopedEntity; this service scopes it explicitly by `company`. `code` is unique within a
 * company and immutable; a category referenced by any document type may only be deactivated, not
 * hard-deleted.
 */
@Injectable()
export class DocumentCategoryService {
  constructor(private readonly em: EntityManager) {}

  // Only the active company's categories (invariant 1). Active-only by default; the admin surface
  // passes includeInactive so the status filter and re-activation can see deactivated rows.
  list(q: PaginationQueryDto = {}, includeInactive = false): Promise<Paginated<DocumentCategory>> {
    const companyId = RequestContext.companyId()!;
    const where = includeInactive
      ? { company: companyId }
      : { company: companyId, isActive: true };
    return paginate(this.em.fork(), DocumentCategory, where, {}, q);
  }

  async get(id: string): Promise<DocumentCategory> {
    const companyId = RequestContext.companyId()!;
    // Scoped by company: a category of another company is not found.
    const category = await this.em.findOne(DocumentCategory, { id, company: companyId });
    if (!category) throw new NotFoundException(`Document category ${id} not found`);
    return category;
  }

  async create(dto: CreateDocumentCategoryDto): Promise<DocumentCategory> {
    const companyId = RequestContext.companyId()!;
    // Uniqueness is per company: check within this company only.
    const dup = await this.em.findOne(DocumentCategory, { company: companyId, code: dto.code });
    if (dup) {
      throw new ConflictException(`Document category code '${dto.code}' already exists in this company`);
    }

    const category = this.em.create(DocumentCategory, {
      company: this.em.getReference(Company, companyId),
      code: dto.code,
      name: dto.name,
      isActive: true,
    });
    try {
      await this.em.persistAndFlush(category);
    } catch (e) {
      // Lost the unique-constraint race with a concurrent create — still a 409.
      if (e instanceof UniqueConstraintViolationException) {
        throw new ConflictException(`Document category code '${dto.code}' already exists in this company`);
      }
      throw e;
    }
    return category;
  }

  // Only `name` and active state may change; `code` is immutable (not present on the DTO).
  async update(id: string, dto: UpdateDocumentCategoryDto): Promise<DocumentCategory> {
    const category = await this.get(id);
    if (dto.name !== undefined) category.name = dto.name;
    if (dto.isActive !== undefined) category.isActive = dto.isActive;
    await this.em.flush();
    return category;
  }

  // Hard-delete is allowed only when no document type references the category (by code); otherwise
  // the caller must deactivate it instead (design decision 3), so existing types keep a valid
  // category. document_type.category carries the category *code*, so match on that.
  async remove(id: string): Promise<void> {
    const companyId = RequestContext.companyId()!;
    const category = await this.get(id);
    const refCount = await this.em.count(DocumentType, { company: companyId, category: category.code });
    if (refCount > 0) {
      throw new BadRequestException(
        'This category is used by one or more document types; deactivate it instead of deleting.',
      );
    }
    await this.em.removeAndFlush(category);
  }
}

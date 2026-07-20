import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import {
  paginate,
  type Paginated,
  type PaginationQueryDto,
} from '../../common/pagination/pagination';
import { Company } from '../multi-company/multi-company.entities';
import { DocumentCategory, DocumentType } from './document.entities';
import type { CreateDocumentTypeDto, UpdateDocumentTypeDto } from './dto/config.dto';

/**
 * document_type registry, owned per company (invariant 1). DocumentType is not a
 * CompanyScopedEntity (that would auto-filter every documentType read across the app); this
 * service scopes it explicitly by `company`, and `code` is unique within a company.
 */
@Injectable()
export class DocumentTypeService {
  constructor(private readonly em: EntityManager) {}

  async create(dto: CreateDocumentTypeDto): Promise<DocumentType> {
    const companyId = RequestContext.companyId()!;
    // Uniqueness is per company: check within this company only.
    const dup = await this.em.findOne(DocumentType, { company: companyId, code: dto.code });
    if (dup) throw new BadRequestException(`Document type code '${dto.code}' already exists in this company`);

    // Category is a document_category code of the active company (invariant 1): reject a code
    // that isn't an active category of this company (config over code — the allowed set is data).
    await this.requireCategory(dto.category);

    const docType = this.em.create(DocumentType, {
      company: this.em.getReference(Company, companyId),
      code: dto.code,
      name: dto.name,
      category: dto.category,
      requiresBudget: dto.requiresBudget ?? false,
      requiresQuota: dto.requiresQuota ?? false,
      requiresVendor: dto.requiresVendor ?? false,
      requiresItem: dto.requiresItem ?? false,
      requiresPayee: dto.requiresPayee ?? false,
      defaultGlAccount: dto.defaultGlAccount,
      postAction: dto.postAction,
      isActive: true,
    });
    await this.em.persistAndFlush(docType);
    return docType;
  }

  /**
   * Assert `code` is an active document_category of the active company, or reject. A category of
   * another company (or an inactive/unknown code) is not found, so cross-company or bogus codes
   * are rejected — the same company-scoped validation the rest of the config path uses.
   */
  private async requireCategory(code: string): Promise<DocumentCategory> {
    const companyId = RequestContext.companyId()!;
    const category = await this.em.findOne(DocumentCategory, {
      company: companyId,
      code,
      isActive: true,
    });
    if (!category) {
      throw new BadRequestException(`Document category '${code}' is not an active category in this company`);
    }
    return category;
  }

  async update(id: string, dto: UpdateDocumentTypeDto): Promise<DocumentType> {
    const docType = await this.get(id);
    if (dto.name !== undefined) docType.name = dto.name;
    if (dto.requiresBudget !== undefined) docType.requiresBudget = dto.requiresBudget;
    if (dto.requiresQuota !== undefined) docType.requiresQuota = dto.requiresQuota;
    if (dto.requiresVendor !== undefined) docType.requiresVendor = dto.requiresVendor;
    if (dto.requiresItem !== undefined) docType.requiresItem = dto.requiresItem;
    if (dto.requiresPayee !== undefined) docType.requiresPayee = dto.requiresPayee;
    if (dto.defaultGlAccount !== undefined) docType.defaultGlAccount = dto.defaultGlAccount;
    if (dto.postAction !== undefined) docType.postAction = dto.postAction;
    if (dto.isActive !== undefined) docType.isActive = dto.isActive;
    await this.em.flush();
    return docType;
  }

  // Only the active company's types (invariant 1).
  list(q: PaginationQueryDto = {}, includeInactive = false): Promise<Paginated<DocumentType>> {
    const companyId = RequestContext.companyId()!;
    const where = includeInactive ? { company: companyId } : { company: companyId, isActive: true };
    return paginate(this.em.fork(), DocumentType, where, {}, q);
  }

  async get(id: string): Promise<DocumentType> {
    const companyId = RequestContext.companyId()!;
    // Scoped by company: a type of another company is not found.
    const docType = await this.em.findOne(DocumentType, { id, company: companyId });
    if (!docType) throw new NotFoundException(`Document type ${id} not found`);
    return docType;
  }
}

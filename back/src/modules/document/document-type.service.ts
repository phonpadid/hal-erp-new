import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import {
  paginate,
  type Paginated,
  type PaginationQueryDto,
} from '../../common/pagination/pagination';
import { Company } from '../multi-company/multi-company.entities';
import { DocumentType } from './document.entities';
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

    const docType = this.em.create(DocumentType, {
      company: this.em.getReference(Company, companyId),
      code: dto.code,
      name: dto.name,
      category: dto.category,
      requiresBudget: dto.requiresBudget ?? false,
      requiresQuota: dto.requiresQuota ?? false,
      requiresVendor: dto.requiresVendor ?? false,
      requiresItem: dto.requiresItem ?? false,
      defaultGlAccount: dto.defaultGlAccount,
      postAction: dto.postAction,
      isActive: true,
    });
    await this.em.persistAndFlush(docType);
    return docType;
  }

  async update(id: string, dto: UpdateDocumentTypeDto): Promise<DocumentType> {
    const docType = await this.get(id);
    if (dto.name !== undefined) docType.name = dto.name;
    if (dto.requiresBudget !== undefined) docType.requiresBudget = dto.requiresBudget;
    if (dto.requiresQuota !== undefined) docType.requiresQuota = dto.requiresQuota;
    if (dto.requiresVendor !== undefined) docType.requiresVendor = dto.requiresVendor;
    if (dto.requiresItem !== undefined) docType.requiresItem = dto.requiresItem;
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

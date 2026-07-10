import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  paginate,
  type Paginated,
  type PaginationQueryDto,
} from '../../common/pagination/pagination';
import { DocumentType } from './document.entities';
import type { CreateDocumentTypeDto, UpdateDocumentTypeDto } from './dto/config.dto';

/** document_type registry (global master). Behavior flags drive runtime (invariant 7). */
@Injectable()
export class DocumentTypeService {
  constructor(private readonly em: EntityManager) {}

  async create(dto: CreateDocumentTypeDto): Promise<DocumentType> {
    const docType = this.em.create(DocumentType, {
      code: dto.code,
      name: dto.name,
      category: dto.category,
      requiresBudget: dto.requiresBudget ?? false,
      requiresQuota: dto.requiresQuota ?? false,
      requiresVendor: dto.requiresVendor ?? false,
      requiresItem: dto.requiresItem ?? false,
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
    if (dto.postAction !== undefined) docType.postAction = dto.postAction;
    if (dto.isActive !== undefined) docType.isActive = dto.isActive;
    await this.em.flush();
    return docType;
  }

  list(q: PaginationQueryDto = {}, includeInactive = false): Promise<Paginated<DocumentType>> {
    return paginate(this.em.fork(), DocumentType, includeInactive ? {} : { isActive: true }, {}, q);
  }

  async get(id: string): Promise<DocumentType> {
    const docType = await this.em.findOne(DocumentType, { id });
    if (!docType) throw new NotFoundException(`Document type ${id} not found`);
    return docType;
  }
}

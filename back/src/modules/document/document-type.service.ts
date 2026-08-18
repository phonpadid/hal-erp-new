import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { POST_JOURNAL } from '@erp/shared';
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
    if (dto.postAction === POST_JOURNAL) await this.assertNoOtherVoucherType(companyId);

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
      accruesOnApproval: dto.accruesOnApproval ?? false,
      requiresWarehouse: dto.requiresWarehouse ?? false,
      requiresEmployee: dto.requiresEmployee ?? false,
      authoringRoute: dto.authoringRoute ?? undefined,
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

  /**
   * At most one active POST_JOURNAL type per company.
   *
   * `JournalVoucherService` resolves the voucher type by this post-action and refuses to proceed
   * when a company has two, so without this the failure surfaces the next time somebody writes a
   * voucher — long after the configuration that caused it, and to a person who cannot fix it.
   * Only POST_JOURNAL: the budget movement actions deliberately allow several candidates and ask
   * the caller to choose (`resolveMovementDocType`).
   */
  private async assertNoOtherVoucherType(companyId: string, exceptId?: string): Promise<void> {
    const existing = await this.em.find(DocumentType, {
      company: companyId,
      postAction: POST_JOURNAL,
      isActive: true,
      ...(exceptId ? { id: { $ne: exceptId } } : {}),
    });
    if (existing.length) {
      throw new BadRequestException(
        `This company already has an active '${POST_JOURNAL}' document type ` +
          `('${existing[0].code}'). Deactivate it before configuring another.`,
      );
    }
  }

  async update(id: string, dto: UpdateDocumentTypeDto): Promise<DocumentType> {
    const docType = await this.get(id);
    if (dto.name !== undefined) docType.name = dto.name;
    if (dto.requiresBudget !== undefined) docType.requiresBudget = dto.requiresBudget;
    if (dto.requiresQuota !== undefined) docType.requiresQuota = dto.requiresQuota;
    if (dto.requiresVendor !== undefined) docType.requiresVendor = dto.requiresVendor;
    if (dto.requiresItem !== undefined) docType.requiresItem = dto.requiresItem;
    if (dto.requiresPayee !== undefined) docType.requiresPayee = dto.requiresPayee;
    if (dto.accruesOnApproval !== undefined) docType.accruesOnApproval = dto.accruesOnApproval;
    if (dto.requiresWarehouse !== undefined) docType.requiresWarehouse = dto.requiresWarehouse;
    if (dto.requiresEmployee !== undefined) docType.requiresEmployee = dto.requiresEmployee;
    // null clears it, returning the type to the generic wizard.
    if (dto.authoringRoute !== undefined) docType.authoringRoute = dto.authoringRoute ?? undefined;
    if (dto.defaultGlAccount !== undefined) docType.defaultGlAccount = dto.defaultGlAccount;
    // null from the client means "clear it"; the column spells absence as null either way.
    if (dto.postAction !== undefined) docType.postAction = dto.postAction ?? undefined;
    if (dto.isActive !== undefined) docType.isActive = dto.isActive;
    // Checked on the resulting state rather than on the dto, so it catches both directions: the
    // flag set on a type that already requires a payee, and a payee required on one that accrues.
    if (docType.postAction === POST_JOURNAL && docType.isActive) {
      await this.assertNoOtherVoucherType(docType.company.id, docType.id);
    }
    await this.em.flush();
    return docType;
  }

  // A type may both accrue at approval and require a payee. That combination used to be rejected
  // here, because the accrual and the settlement posting debited the same expense accounts and the
  // expense would land in the ledger twice. `postForPayment` now clears the payable an accrual
  // raised instead of debiting expense again, so a purchase type recognises its expense exactly
  // once, at approval, and its payment moves only cash and the payable. That branch is what
  // replaces this guard — it is the thing to check if double recognition is ever suspected again.

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

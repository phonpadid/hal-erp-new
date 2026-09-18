import { wrap, type EntityDTO } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { formatPrintTemplates, POST_JOURNAL, settlesBudget, STOCK_POST_ACTIONS } from '@erp/shared';
import type { PrintTemplate } from '@erp/shared';
import { RequestContext } from '../../common/context/request-context';
import {
  paginate,
  type Paginated,
  type PaginationQueryDto,
} from '../../common/pagination/pagination';
import { Company } from '../multi-company/multi-company.entities';
import { Permission } from '../rbac/rbac.entities';
import { DocumentCategory, DocumentType } from './document.entities';
import {
  assertNoReservingTypeStranded,
  assertReservationCanBeSettled,
} from './ref-chain.config';
import type { CreateDocumentTypeDto, UpdateDocumentTypeDto } from './dto/config.dto';

/**
 * A document type as the config API returns it: the entity's own fields, with `printTemplates`
 * carrying the parsed list the clients declare rather than the column's comma-separated text.
 */
export type DocumentTypeRow = Omit<EntityDTO<DocumentType>, 'printTemplates'> & {
  printTemplates: PrintTemplate[];
};

const toRow = (t: DocumentType): DocumentTypeRow => ({
  ...(wrap(t).toObject() as EntityDTO<DocumentType>),
  printTemplates: t.sheets(),
});

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
    const viewPermissionCode = await this.requireViewPermissionCode(dto.viewPermissionCode);
    if (dto.postAction === POST_JOURNAL) await this.assertNoOtherVoucherType(companyId);
    // Ahead of `em.create`, which persists on create: an entity built and then rejected stays in
    // the unit of work and the next flush writes it, so a refused type can appear to exist.
    //
    // Only the accrual-timing rule runs here. Reachability cannot: a pairing names two existing
    // types, so a type being created has no edges and can have none. Requiring one would make a
    // type settled further down its chain impossible to configure. It binds when the type is
    // mapped to a department instead — the point at which a document can first be raised (D6).
    const prospective = {
      code: dto.code,
      requiresBudget: dto.requiresBudget ?? false,
      requiresVendor: dto.requiresVendor ?? false,
      requiresPayee: dto.requiresPayee ?? false,
      requiresWarehouse: dto.requiresWarehouse ?? false,
      accruesOnApproval: dto.accruesOnApproval ?? false,
      postAction: dto.postAction ?? undefined,
      isActive: true,
    };
    this.assertAccrualSettlesItself(prospective);
    this.assertFlagPrerequisites(prospective);

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
      recordsPastEvents: dto.recordsPastEvents ?? false,
      // Omitted leaves the entity defaults: THREE_WAY, and no receipts.
      ...(dto.matchMode ? { matchMode: dto.matchMode } : {}),
      ...(dto.receivesGoods !== undefined ? { receivesGoods: dto.receivesGoods } : {}),
      authoringRoute: dto.authoringRoute ?? undefined,
      viewPermissionCode,
      defaultGlAccount: dto.defaultGlAccount,
      postAction: dto.postAction,
      // Omitted leaves the entity default (LETTER) — the sheet a type prints when nobody chose one.
      ...(dto.printTemplates
        ? { printTemplates: formatPrintTemplates(dto.printTemplates) }
        : {}),
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
   * The read gate a type may carry, normalised: null/'' → undefined (no gate); a code → itself,
   * provided it is an ACTIVE row of the permission catalog. A soft code reference like
   * `requireCategory`, and for the same reason: codes are what the system authorises on, and a
   * misspelt gate would silently hide a type from everyone but its creators and approvers.
   */
  private async requireViewPermissionCode(code: string | null | undefined): Promise<string | undefined> {
    const trimmed = code?.trim();
    if (!trimmed) return undefined;
    const row = await this.em.findOne(Permission, { code: trimmed, isActive: true });
    if (!row) {
      throw new BadRequestException(`Permission code '${trimmed}' is not an active permission`);
    }
    return trimmed;
  }

  /**
   * The active permission codes an administrator may set as a type's read gate — `code`, `name`,
   * `module` and nothing else. Served under DOC_CONFIG_MANAGE because the catalog's own listing sits
   * under RBAC_MANAGE, which a document-config administrator need not hold; it discloses only what
   * the catalog already declares in source.
   */
  async listPermissionCodes(): Promise<Array<{ code: string; name: string; module: string }>> {
    const rows = await this.em.find(
      Permission,
      { isActive: true },
      { fields: ['code', 'name', 'module'], orderBy: { module: 'ASC', code: 'ASC' } },
    );
    return rows.map((r) => ({ code: r.code, name: r.name, module: r.module }));
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
    // Editable like the flags above: `create` has always honoured it, so a type could be born with
    // it set but never have it changed, and the edit form's toggle moved nothing.
    if (dto.recordsPastEvents !== undefined) docType.recordsPastEvents = dto.recordsPastEvents;
    if (dto.matchMode !== undefined) docType.matchMode = dto.matchMode;
    if (dto.receivesGoods !== undefined) docType.receivesGoods = dto.receivesGoods;
    // null clears it, returning the type to the generic wizard.
    if (dto.authoringRoute !== undefined) docType.authoringRoute = dto.authoringRoute ?? undefined;
    // null (or '') clears the gate; a code is checked against the catalog before it is stored.
    if (dto.viewPermissionCode !== undefined) {
      docType.viewPermissionCode = await this.requireViewPermissionCode(dto.viewPermissionCode);
    }
    if (dto.defaultGlAccount !== undefined) docType.defaultGlAccount = dto.defaultGlAccount;
    // null from the client means "clear it"; the column spells absence as null either way.
    if (dto.postAction !== undefined) docType.postAction = dto.postAction ?? undefined;
    // Not nullable and never empty: clearing the sheets a type prints is not a state — printing
    // only the letter is chosen explicitly. Stored in print order, whatever order they arrive in.
    if (dto.printTemplates) docType.printTemplates = formatPrintTemplates(dto.printTemplates);
    if (dto.isActive !== undefined) docType.isActive = dto.isActive;
    // Checked on the resulting state rather than on the dto, so it catches both directions: the
    // flag set on a type that already requires a payee, and a payee required on one that accrues.
    if (docType.postAction === POST_JOURNAL && docType.isActive) {
      await this.assertNoOtherVoucherType(docType.company.id, docType.id);
    }
    this.assertAccrualSettlesItself(docType);
    this.assertFlagPrerequisites(docType);
    await assertReservationCanBeSettled(this.em, docType.company.id, docType);
    // Deactivating or un-settling THIS type can strand a reservation belonging to ANOTHER one: the
    // graph breaks from either end, and only the write that breaks it can still name the cause.
    await assertNoReservingTypeStranded(this.em, docType.company.id);
    await this.em.flush();
    return docType;
  }

  /**
   * Flags that mean nothing without another flag on the SAME row. Each is decided from that row
   * alone — no query, no reference graph, no knowledge of who will submit — which is what makes
   * them safe to answer here rather than at submit.
   *
   * The message names the flag that is MISSING rather than the one that is present: either could be
   * the one the administrator meant to set, and adding the prerequisite is the far more common fix.
   *
   * Binds on the resulting state and only while the type is active, like every other rule in this
   * file — so removing a prerequisite is refused as surely as never setting one.
   */
  private assertFlagPrerequisites(
    t: Pick<
      DocumentType,
      'code' | 'requiresBudget' | 'requiresVendor' | 'requiresPayee' | 'requiresWarehouse' | 'accruesOnApproval' | 'postAction' | 'isActive'
    >,
  ): void {
    if (!t.isActive) return;

    // A payee IS a vendor's bank account: submit refuses one that does not belong to the document's
    // vendor, and the client's picker is loaded from the vendor. Without the vendor the required
    // field can never be filled, and every submit is refused for something nobody could supply.
    if (t.requiresPayee && !t.requiresVendor) {
      throw new BadRequestException(
        `Document type '${t.code}' requires a payee but not a vendor. A payee is a vendor's bank account, so the payee field would have nothing to offer and the document could never be submitted — require a vendor as well.`,
      );
    }

    // Stock moves out of somewhere, and for a transfer into somewhere else. EVERY check that
    // establishes those sits behind `requires_warehouse`, so without it they are not merely
    // inapplicable — they are skipped, and the reservation proceeds on a warehouse never named.
    // Read from the declared set rather than a list of type codes (invariant 7). Note this is the
    // stock-MOVING set, not the reserving one: an adjustment holds nothing but must still say
    // which shelf it corrects.
    if (t.postAction && STOCK_POST_ACTIONS.includes(t.postAction) && !t.requiresWarehouse) {
      throw new BadRequestException(
        `Document type '${t.code}' moves stock but does not require a warehouse. The warehouse checks are conditional on that flag, so a document of this type would reach the stock movement without one — require a warehouse.`,
      );
    }

    // The accrual recognises the expense from the document's ACTUAL budget rows: its own when there
    // is no vendor, and the charged ancestor's when there is. A type with neither has no source at
    // all, so its accrual can only ever record a terminal skip — approved, and nowhere in the books.
    //
    // A vendor is enough HERE. Whether its reference chain actually reaches a predecessor that
    // reserved depends on the configured pairings, not on this row, and is not decided here (D3).
    if (t.accruesOnApproval && !t.requiresBudget && !t.requiresVendor) {
      throw new BadRequestException(
        `Document type '${t.code}' recognises its expense at approval but requires neither budget nor a vendor, so there is nothing for the accrual to read — require budget of its own, or a vendor whose reference chain carries the charge.`,
      );
    }
  }

  /**
   * Timing, not existence. A type that reserves its own budget AND recognises its expense at
   * approval must settle at that same approval: the accrual reads this document's ACTUAL rows, and
   * a settlement further down the reference chain runs long after the accrual has given up and
   * recorded a terminal skip. So this is NOT satisfied by reachability, and it is checked first so
   * the more specific message is the one the administrator sees.
   *
   * Reads the RESULTING state rather than the dto, like the voucher guard, so it catches both
   * directions — the flag set on a type that already reserves, and budget required on one that
   * already accrues. Needs no pairing graph, so unlike reachability it also binds at create.
   */
  private assertAccrualSettlesItself(
    t: Pick<DocumentType, 'code' | 'requiresBudget' | 'accruesOnApproval' | 'postAction' | 'isActive'>,
  ): void {
    if (!t.isActive || !t.requiresBudget || !t.accruesOnApproval) return;
    if (settlesBudget(t.postAction)) return;
    throw new BadRequestException(
      `Document type '${t.code}' recognises its expense at approval and reserves its own budget, so it must settle that reservation itself — give it a settling post-action. A settlement further down the reference chain runs after the accrual has already been recorded as skipped.`,
    );
  }

  // A type may both accrue at approval and require a payee. That combination used to be rejected
  // here, because the accrual and the settlement posting debited the same expense accounts and the
  // expense would land in the ledger twice. `postForPayment` now clears the payable an accrual
  // raised instead of debiting expense again, so a purchase type recognises its expense exactly
  // once, at approval, and its payment moves only cash and the payable. That branch is what
  // replaces this guard — it is the thing to check if double recognition is ever suspected again.

  /**
   * Only the active company's types (invariant 1).
   *
   * `printTemplates` goes out as the LIST, not as the comma-separated column behind it. The
   * client's schema, the update DTO and the config form all speak arrays; serialising the entity
   * raw sent a string, and the edit form's multi-select rendered one empty chip per CHARACTER of
   * it and then refused every save, because the array the schema wanted never arrived.
   */
  async list(q: PaginationQueryDto = {}, includeInactive = false): Promise<Paginated<DocumentTypeRow>> {
    const companyId = RequestContext.companyId()!;
    const where = includeInactive ? { company: companyId } : { company: companyId, isActive: true };
    const page = await paginate(this.em.fork(), DocumentType, where, {}, q);
    return { ...page, items: page.items.map(toRow) };
  }

  async get(id: string): Promise<DocumentType> {
    const companyId = RequestContext.companyId()!;
    // Scoped by company: a type of another company is not found.
    const docType = await this.em.findOne(DocumentType, { id, company: companyId });
    if (!docType) throw new NotFoundException(`Document type ${id} not found`);
    return docType;
  }
}

import { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { HttpStatus, Injectable } from '@nestjs/common';
import { explained } from '../../common/errors/error-code';
import { RequestContext } from '../../common/context/request-context';
import { Company, Department } from '../multi-company/multi-company.entities';
import { DocumentType, DocumentTypeRef } from './document.entities';
import { assertNoReservingTypeStranded, strandedReservingTypes } from './ref-chain.config';
import type { CreateRefPairingDto, UpdateRefPairingDto } from './dto/config.dto';

/**
 * Every read here scopes by an explicit `company: companyId` term, which IS the isolation
 * (invariant 1). The default `company` filter must be off: `document_type_ref` now relates to
 * `department`, and MikroORM arms a related entity's filter on the join — the filter has no
 * argument bound outside a request, so it throws instead of matching.
 */
const FILTER_OFF = { filters: { company: false } } as const;

/** One end of a pairing as returned to the admin UI. */
export interface PairingView {
  id: string;
  predecessorTypeId: string;
  predecessorCode: string;
  successorTypeId: string;
  successorCode: string;
  // Whether CREATE_SUCCESSOR auto-creates this successor on the predecessor's approval.
  autoCreate: boolean;
  // Department an auto-created successor lands in; null = the source document's own department.
  // Only auto_create reads it — a manual create-from takes the creating user's department.
  successorDepartmentId: string | null;
}

/**
 * document_type_ref admin: the reference-chain pairings (predecessor→successor) a company
 * allows for create-from and the CREATE_SUCCESSOR post-action. Configuration, not code (invariant 7),
 * scoped to the active company (invariant 1) — both pairing endpoints must be that company's
 * document types. DocumentTypeRef is not a CompanyScopedEntity, so `company` is filtered
 * explicitly here, exactly like DocumentType / DeptDocType.
 */
@Injectable()
export class RefChainService {
  constructor(private readonly em: EntityManager) {}

  /**
   * A department of the active company, or reject. Mirrors requireType: a department of another
   * company must not become a pairing's successor department, or an approval in company A would
   * create its successor in company B (invariant 1).
   */
  private async requireDepartment(id: string): Promise<Department> {
    const companyId = RequestContext.companyId()!;
    // filters off: `company: companyId` above IS the scope. Leaving the default filter armed makes
    // this throw wherever no request bound a company — and it would be redundant with the term.
    const dept = await this.em.findOne(
      Department,
      { id, company: companyId },
      { filters: { company: false } },
    );
    if (!dept) throw explained('config.notFound.department', {}, 'Department not found', HttpStatus.NOT_FOUND);
    return dept;
  }

  /** A document type of the active company, or reject (a type of another company is not found). */
  private async requireType(id: string): Promise<DocumentType> {
    const companyId = RequestContext.companyId()!;
    const type = await this.em.findOne(DocumentType, { id, company: companyId }, FILTER_OFF);
    if (!type) throw explained('config.notFound.type', {}, 'Document type not found', HttpStatus.NOT_FOUND);
    return type;
  }

  /**
   * The pairings touching `documentTypeId`, split into the successors it may create and the
   * predecessors it may be created from. Scoped to the active company.
   */
  async listForType(
    documentTypeId: string,
  ): Promise<{ successors: PairingView[]; predecessors: PairingView[] }> {
    const type = await this.requireType(documentTypeId);
    const companyId = RequestContext.companyId()!;
    const rows = await this.em.find(
      DocumentTypeRef,
      {
        company: companyId,
        $or: [{ predecessorType: type.id }, { successorType: type.id }],
      },
      {
        populate: ['predecessorType', 'successorType', 'successorDepartment'],
        // `successorDepartment` is company-scoped, so populating it arms the `company` filter —
        // which has no argument to bind unless a request set one. The `company: companyId` term
        // above IS the scope (invariant 1), and the department is validated to be of that same
        // company when the pairing is written.
        filters: { company: false },
      },
    );
    const view = (r: DocumentTypeRef): PairingView => ({
      id: r.id,
      predecessorTypeId: r.predecessorType.id,
      predecessorCode: r.predecessorType.code,
      successorTypeId: r.successorType.id,
      successorCode: r.successorType.code,
      autoCreate: r.autoCreate,
      successorDepartmentId: r.successorDepartment?.id ?? null,
    });
    return {
      successors: rows.filter((r) => r.predecessorType.id === type.id).map(view),
      predecessors: rows.filter((r) => r.successorType.id === type.id).map(view),
    };
  }

  /**
   * Add a pairing. Both types must be document types of the active company (invariant 1) and
   * must differ; the (company, predecessor, successor) uniqueness is enforced by the DB index,
   * surfaced here as a 409 rather than an opaque 500.
   */
  async addPairing(dto: CreateRefPairingDto): Promise<DocumentTypeRef> {
    const companyId = RequestContext.companyId()!;
    if (dto.predecessorTypeId === dto.successorTypeId) {
      throw explained('config.pairing.selfChain', {}, 'A document type cannot chain to itself');
    }
    // requireType scopes each side to the active company, so a cross-company type is rejected.
    await this.requireType(dto.predecessorTypeId);
    await this.requireType(dto.successorTypeId);
    if (dto.successorDepartmentId) await this.requireDepartment(dto.successorDepartmentId);

    const existing = await this.em.findOne(
      DocumentTypeRef,
      {
        company: companyId,
        predecessorType: dto.predecessorTypeId,
        successorType: dto.successorTypeId,
      },
      FILTER_OFF,
    );
    if (existing) throw explained('config.pairing.duplicate', {}, 'This reference-chain pairing already exists', HttpStatus.CONFLICT);

    const pairing = this.em.create(DocumentTypeRef, {
      company: this.em.getReference(Company, companyId),
      predecessorType: this.em.getReference(DocumentType, dto.predecessorTypeId),
      successorType: this.em.getReference(DocumentType, dto.successorTypeId),
      autoCreate: dto.autoCreate ?? false,
      successorDepartment: dto.successorDepartmentId
        ? this.em.getReference(Department, dto.successorDepartmentId)
        : undefined,
    });
    try {
      await this.em.persistAndFlush(pairing);
    } catch (e) {
      // Lost the unique-constraint race with a concurrent add — still a 409.
      if (e instanceof UniqueConstraintViolationException) {
        throw explained('config.pairing.duplicate', {}, 'This reference-chain pairing already exists', HttpStatus.CONFLICT);
      }
      throw e;
    }
    return pairing;
  }

  /**
   * Update a pairing's auto-create flag (whether CREATE_SUCCESSOR auto-creates this successor on
   * the predecessor's approval) and its successor department, scoped to the active company.
   *
   * Editing the department only affects obligations recorded afterwards: `pending_successor`
   * resolves and stores its department when the approval commits, so a pairing edited later cannot
   * redirect a handoff those approvers already granted.
   */
  async setAutoCreate(id: string, dto: UpdateRefPairingDto): Promise<DocumentTypeRef> {
    const companyId = RequestContext.companyId()!;
    const pairing = await this.em.findOne(DocumentTypeRef, { id, company: companyId }, FILTER_OFF);
    if (!pairing) throw explained('config.notFound.pairing', {}, 'Reference-chain pairing not found', HttpStatus.NOT_FOUND);
    pairing.autoCreate = dto.autoCreate;
    if (dto.successorDepartmentId !== undefined) {
      // null clears it (back to the source document's department); a value must be this company's.
      if (dto.successorDepartmentId === null) {
        pairing.successorDepartment = undefined;
      } else {
        pairing.successorDepartment = await this.requireDepartment(dto.successorDepartmentId);
      }
    }
    await this.em.flush();
    return pairing;
  }

  /**
   * Remove a pairing, scoped to the active company (a pairing of another company is not found).
   *
   * Refused when the removal would leave an active reserving type with no way to settle: a pairing
   * can be the only edge on somebody's route to a settlement, and this write is the last place the
   * cause is still visible. Removed inside a transaction and asserted afterwards, so the check
   * walks the graph as it would actually be — the throw rolls the deletion back.
   */
  async removePairing(id: string): Promise<void> {
    const companyId = RequestContext.companyId()!;
    await this.em.transactional(async (tem) => {
      const pairing = await tem.findOne(DocumentTypeRef, { id, company: companyId }, FILTER_OFF);
      if (!pairing) throw explained('config.notFound.pairing', {}, 'Reference-chain pairing not found', HttpStatus.NOT_FOUND);
      // Only what THIS removal breaks is refused; a type stranded before it is not its fault.
      const strandedBefore = await strandedReservingTypes(tem, companyId);
      tem.remove(pairing);
      await tem.flush();
      await assertNoReservingTypeStranded(tem, companyId, strandedBefore);
    });
  }
}

import { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { Company } from '../multi-company/multi-company.entities';
import { DocumentType, DocumentTypeRef } from './document.entities';
import type { CreateRefPairingDto, UpdateRefPairingDto } from './dto/config.dto';

/** One end of a pairing as returned to the admin UI. */
export interface PairingView {
  id: string;
  predecessorTypeId: string;
  predecessorCode: string;
  successorTypeId: string;
  successorCode: string;
  // Whether CREATE_SUCCESSOR auto-creates this successor on the predecessor's approval.
  autoCreate: boolean;
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

  /** A document type of the active company, or reject (a type of another company is not found). */
  private async requireType(id: string): Promise<DocumentType> {
    const companyId = RequestContext.companyId()!;
    const type = await this.em.findOne(DocumentType, { id, company: companyId });
    if (!type) throw new NotFoundException(`Document type ${id} not found`);
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
      { populate: ['predecessorType', 'successorType'] },
    );
    const view = (r: DocumentTypeRef): PairingView => ({
      id: r.id,
      predecessorTypeId: r.predecessorType.id,
      predecessorCode: r.predecessorType.code,
      successorTypeId: r.successorType.id,
      successorCode: r.successorType.code,
      autoCreate: r.autoCreate,
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
      throw new BadRequestException('A document type cannot chain to itself');
    }
    // requireType scopes each side to the active company, so a cross-company type is rejected.
    await this.requireType(dto.predecessorTypeId);
    await this.requireType(dto.successorTypeId);

    const existing = await this.em.findOne(DocumentTypeRef, {
      company: companyId,
      predecessorType: dto.predecessorTypeId,
      successorType: dto.successorTypeId,
    });
    if (existing) throw new ConflictException('This reference-chain pairing already exists');

    const pairing = this.em.create(DocumentTypeRef, {
      company: this.em.getReference(Company, companyId),
      predecessorType: this.em.getReference(DocumentType, dto.predecessorTypeId),
      successorType: this.em.getReference(DocumentType, dto.successorTypeId),
      autoCreate: dto.autoCreate ?? false,
    });
    try {
      await this.em.persistAndFlush(pairing);
    } catch (e) {
      // Lost the unique-constraint race with a concurrent add — still a 409.
      if (e instanceof UniqueConstraintViolationException) {
        throw new ConflictException('This reference-chain pairing already exists');
      }
      throw e;
    }
    return pairing;
  }

  /**
   * Toggle a pairing's auto-create flag (whether CREATE_SUCCESSOR auto-creates this successor on
   * the predecessor's approval), scoped to the active company.
   */
  async setAutoCreate(id: string, dto: UpdateRefPairingDto): Promise<DocumentTypeRef> {
    const companyId = RequestContext.companyId()!;
    const pairing = await this.em.findOne(DocumentTypeRef, { id, company: companyId });
    if (!pairing) throw new NotFoundException(`Reference-chain pairing ${id} not found`);
    pairing.autoCreate = dto.autoCreate;
    await this.em.flush();
    return pairing;
  }

  /** Remove a pairing, scoped to the active company (a pairing of another company is not found). */
  async removePairing(id: string): Promise<void> {
    const companyId = RequestContext.companyId()!;
    const pairing = await this.em.findOne(DocumentTypeRef, { id, company: companyId });
    if (!pairing) throw new NotFoundException(`Reference-chain pairing ${id} not found`);
    await this.em.removeAndFlush(pairing);
  }
}

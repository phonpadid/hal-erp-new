import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { DocStatus } from '../../common/enums';
import { coded, ErrorCode } from '../../common/errors/error-code';
import { StorageService } from '../../common/storage/storage.service';
import { validateUpload, type UploadedFile } from '../../common/storage/upload';
import { GlPostingService } from '../gl/gl-posting.service';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import {
  Document, DocumentAttachment, DocumentSettlement, DocumentType,
} from './document.entities';
import type { RecordSettlementDto } from './dto/document.dto';

const FILTER_OFF = { filters: { company: false } } as const;
/** Evidence is capped like any other document attachment. */
const EVIDENCE_MAX_SIZE_KB = 10 * 1024;

/**
 * Settlement types this system can record today.
 *
 * `CASH` only. A value outside this set is refused by name rather than treated as cash — the
 * column exists from the first row precisely so the two can be told apart later, and a claim
 * settled by replacing the goods is a different ledger effect, not a cash payment with a different
 * label.
 */
const SUPPORTED_TYPES = new Set(['CASH']);

@Injectable()
export class SettlementService {
  constructor(
    private readonly em: EntityManager,
    private readonly storage: StorageService,
    private readonly posting: GlPostingService,
  ) {}

  /**
   * Record that a compensation was paid, with the evidence that proves it, and clear the payable
   * its approval raised.
   *
   * All of it in ONE transaction. A settlement recorded without its evidence is a claim nobody can
   * audit; evidence stored without a settlement is a file nobody looks at; either without the
   * ledger entry leaves a payable that never clears. Splitting them would open a window on the
   * money side where the system holds one and not the others.
   */
  async record(
    documentId: string,
    dto: RecordSettlementDto,
    file: UploadedFile | undefined,
  ): Promise<DocumentSettlement> {
    if (!file) {
      throw new BadRequestException('Evidence of the settlement is required — attach at least one file');
    }
    if (!SUPPORTED_TYPES.has(dto.settlementType)) {
      throw new BadRequestException(
        `Settlement type '${dto.settlementType}' is not supported yet — only CASH can be recorded`,
      );
    }
    validateUpload(file, null, EVIDENCE_MAX_SIZE_KB);

    const companyId = RequestContext.companyId()!;
    const userId = RequestContext.userId()!;

    // Object storage is not transactional, so the upload happens before the transaction opens. A
    // rolled-back settlement therefore leaves an orphaned object, not a visible half-record —
    // the same trade the attachment upload already makes.
    const key = this.storage.buildKey(documentId, file.originalname);
    await this.storage.putObject(key, file.buffer, file.mimetype);

    return this.em.transactional(async (tem) => {
      const document = await tem.findOne(
        Document,
        { id: documentId },
        { ...FILTER_OFF, populate: ['company', 'documentType'] },
      );
      if (!document || document.company.id !== companyId) {
        throw new NotFoundException(`Document ${documentId} not found`);
      }
      // Resolved by id rather than off the populated relation, which can come back unloaded with
      // its flags undefined — that would let a non-accruing document through this guard.
      const docType = await tem.findOne(DocumentType, { id: document.documentType.id }, FILTER_OFF);
      if (!docType?.accruesOnApproval) {
        throw new BadRequestException(
          'This document type does not accrue on approval — there is no payable to clear, and its ' +
            'payment belongs to the payment flow',
        );
      }
      if (document.status !== DocStatus.COMPLETED) {
        throw coded(
          ErrorCode.INVALID_STATE,
          'Only a fully approved document can be settled',
        );
      }

      const already = await tem.findOne(DocumentSettlement, { document: documentId }, FILTER_OFF);
      if (already) {
        throw coded(
          ErrorCode.INVALID_STATE,
          'This document has already been settled — money does not leave twice',
        );
      }

      const attachment = tem.create(DocumentAttachment, {
        document: tem.getReference(Document, documentId),
        fileName: file.originalname,
        filePath: key,
        fileSizeKb: Math.ceil(file.size / 1024),
        mimeType: file.mimetype,
        uploadedBy: tem.getReference(AppUser, userId),
        uploadedAt: new Date(),
      });
      tem.persist(attachment);

      const settlement = tem.create(DocumentSettlement, {
        company: tem.getReference(Company, companyId),
        document: tem.getReference(Document, documentId),
        settlementType: dto.settlementType,
        settledAt: dto.settledAt,
        reference: dto.reference,
        settledBy: tem.getReference(AppUser, userId),
        note: dto.note,
        createdAt: new Date(),
      });
      tem.persist(settlement);

      // Inside the transaction on purpose: if the ledger cannot record this, the settlement must
      // not be recorded either. Half-done is worse than refused, because the operator would
      // believe it was finished.
      await this.posting.postSettlementClearing(tem, documentId, dto.settlementType);

      return settlement;
    });
  }

  /**
   * Whether a document has been settled, and with what — for a caller entitled to read it.
   *
   * Three fields, and the exclusions are the contract, not an oversight: no evidence file, no
   * recording user, no note. The slip is an audit artefact for our finance team and the actor is an
   * internal accountability record; an external caller asked for a date and a reference so it can
   * tell its customer the money has gone, and that is what it gets. A contract that carries only
   * what was asked for can grow later — one that leaks everything available can only shrink, and
   * shrinking is the breaking change.
   *
   * Not found when the document has no settlement: "not settled yet" is the absence of a thing, and
   * a body of nulls invites a caller to read null as a value and forget the case is still open.
   */
  async readSettlement(
    documentId: string,
  ): Promise<{ settlementType: string; settledAt: string; reference?: string }> {
    const companyId = RequestContext.companyId()!;
    const settlement = await this.em.fork().findOne(
      DocumentSettlement,
      { document: documentId, company: companyId },
      FILTER_OFF,
    );
    if (!settlement) {
      throw new NotFoundException(`Document ${documentId} has no settlement`);
    }
    return {
      settlementType: settlement.settlementType,
      settledAt: settlement.settledAt,
      reference: settlement.reference,
    };
  }

  /**
   * Documents that accrued at approval and have not been settled — the finance queue.
   *
   * Exists so the list of what still has to be paid lives in the system rather than in a
   * spreadsheet beside it, which is where a claim gets paid twice or not at all.
   */
  async listUnsettled(): Promise<
    Array<{ id: string; docNo: string; totalAmount?: string; approvedAt?: Date; department: string }>
  > {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    const accruingTypes = await em.find(
      DocumentType,
      { company: companyId, accruesOnApproval: true },
      FILTER_OFF,
    );
    if (!accruingTypes.length) return [];

    const settled = await em.find(DocumentSettlement, { company: companyId }, FILTER_OFF);
    const settledIds = new Set(settled.map((s) => s.document.id));

    const documents = await em.find(
      Document,
      {
        company: companyId,
        documentType: { $in: accruingTypes.map((t) => t.id) },
        status: DocStatus.COMPLETED,
      },
      { ...FILTER_OFF, populate: ['department'] },
    );
    return documents
      .filter((d) => !settledIds.has(d.id))
      .map((d) => ({
        id: d.id,
        docNo: d.docNo,
        totalAmount: d.totalAmount,
        approvedAt: d.approvedAt,
        department: (d.department as Department).id,
      }));
  }
}

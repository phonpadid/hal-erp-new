import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { inTransaction, lockForUpdate } from '../../common/uow/unit-of-work';
import { Company } from '../multi-company/multi-company.entities';
import { DocRunningNumber, DocumentType } from './document.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Safe per company + type + year document numbering (invariant 7 / concurrency rule).
 * The counter row is locked with SELECT FOR UPDATE before incrementing, so concurrent
 * creates get unique, sequential numbers with no collision.
 */
@Injectable()
export class NumberingService {
  constructor(private readonly em: EntityManager) {}

  /** Ensure the counter row exists (idempotent; tolerates a concurrent creator). */
  private async ensure(
    companyId: string,
    documentTypeId: string,
    year: number,
    prefix: string,
  ): Promise<void> {
    const em = this.em.fork();
    const existing = await em.findOne(
      DocRunningNumber,
      { company: companyId, documentType: documentTypeId, year },
      FILTER_OFF,
    );
    if (existing) return;
    try {
      em.create(DocRunningNumber, {
        company: em.getReference(Company, companyId),
        documentType: em.getReference(DocumentType, documentTypeId),
        year,
        prefix,
        currentNo: 0,
      });
      await em.flush();
    } catch {
      // Another request created it first — fine, the unique index held.
    }
  }

  /** Increment the locked counter and return the formatted document number. */
  async next(
    companyId: string,
    documentTypeId: string,
    year: number,
    prefix: string,
  ): Promise<string> {
    await this.ensure(companyId, documentTypeId, year, prefix);
    return inTransaction(this.em, async (tem) => {
      const row = await lockForUpdate(
        tem,
        DocRunningNumber,
        { company: companyId, documentType: documentTypeId, year },
        FILTER_OFF,
      );
      row!.currentNo += 1;
      await tem.flush();
      return `${row!.prefix ?? ''}${String(row!.currentNo).padStart(4, '0')}`;
    });
  }

  /** Build a prefix like "PR-A-2026-" from type + company codes. */
  static buildPrefix(typeCode: string, companyCode: string, year: number): string {
    return `${typeCode}-${companyCode}-${year}-`;
  }
}

import { Injectable } from '@nestjs/common';
import { paginate, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Document } from '../document/document.entities';
import { JournalEntry } from './gl.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/** Read-only journal query — company-scoped, newest first, with each entry's balanced lines. */
@Injectable()
export class JournalService {
  constructor(private readonly companyScope: CompanyScopeService) {}

  async list(q: PaginationQueryDto = {}): Promise<Paginated<JournalEntry & { sourceDocNo?: string }>> {
    const em = this.companyScope.forActiveCompany();
    const page = await paginate(
      em,
      JournalEntry,
      {},
      { populate: ['lines', 'lines.account'], orderBy: { entryDate: 'DESC', createdAt: 'DESC' } },
      q,
    );

    // Resolve the human-readable document number for each entry's source (PAYMENT → document),
    // so the UI shows/links the doc no instead of a raw UUID. Batch-loaded to avoid N+1.
    const sourceIds = page.items.map((e) => e.sourceId);
    const docs = sourceIds.length
      ? await em.find(Document, { id: { $in: sourceIds } }, { ...FILTER_OFF, fields: ['id', 'docNo'] })
      : [];
    const docNoById = new Map(docs.map((d) => [d.id, d.docNo]));

    return {
      ...page,
      items: page.items.map((e) => Object.assign(e, { sourceDocNo: docNoById.get(e.sourceId) })),
    };
  }
}

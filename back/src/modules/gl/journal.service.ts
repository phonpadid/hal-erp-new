import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { GlPostingStatus } from '../../common/enums';
import { paginate, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Document } from '../document/document.entities';
import { GlPostingAttempt } from './gl-posting.entities';
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

  /**
   * The postings this company owes and has not delivered.
   *
   * "Owed and undelivered" is: a row that is not in a terminal state. POSTED and SKIPPED are
   * terminal, so the query never has to know which sources legitimately post nothing — the posting
   * service decided that once and the row remembers it. Re-deriving those rules here, in SQL, is
   * how the two would drift apart and how this list would fill with sources that are fine.
   *
   * FAILED rows are included deliberately. The attempt bound stops the retrying, not the debt.
   *
   * `from` / `to` bound `lastAttemptAt` so a period close can ask the question for its own range.
   */
  async undelivered(
    q: PaginationQueryDto & { from?: string; to?: string } = {},
  ): Promise<Paginated<GlPostingAttempt & { sourceDocNo?: string }>> {
    const em = this.companyScope.forActiveCompany();
    const where: Record<string, unknown> = {
      status: { $in: [GlPostingStatus.PENDING, GlPostingStatus.FAILED] },
    };
    const attemptedAt: Record<string, Date> = {};
    if (q.from) attemptedAt.$gte = new Date(q.from);
    if (q.to) attemptedAt.$lte = new Date(q.to);
    if (Object.keys(attemptedAt).length) where.lastAttemptAt = attemptedAt;

    const page = await paginate(
      em,
      GlPostingAttempt,
      where,
      { orderBy: { createdAt: 'ASC' } },
      q,
    );

    const sourceIds = page.items.map((r) => r.sourceId);
    const docs = sourceIds.length
      ? await em.find(Document, { id: { $in: sourceIds } }, { ...FILTER_OFF, fields: ['id', 'docNo'] })
      : [];
    const docNoById = new Map(docs.map((d) => [d.id, d.docNo]));

    return {
      ...page,
      items: page.items.map((r) => Object.assign(r, { sourceDocNo: docNoById.get(r.sourceId) })),
    };
  }

  /**
   * Return a FAILED posting to the queue so the next sweep attempts it again.
   *
   * Without this the attempt bound would make a failed posting unpostable forever: an operator
   * reads the undelivered list, maps the account that was missing, and has no way to finish.
   *
   * `lastError` is kept, so the record of what went wrong survives the retry. The operation queues
   * work rather than posting inline, so there stays exactly one code path that attempts a posting.
   */
  async requeue(id: string): Promise<GlPostingAttempt> {
    const em = this.companyScope.forActiveCompany();
    const row = await em.findOne(GlPostingAttempt, { id });
    if (!row) throw new NotFoundException(`Posting attempt ${id} not found`);
    if (row.status !== GlPostingStatus.FAILED) {
      // POSTED and SKIPPED are answers, not stalls. Re-queuing one would ask the engine to redo
      // work it has already concluded — harmless for POSTED (the entry's unique key refuses a
      // second) but meaningless, and for SKIPPED it would reopen a question already settled.
      throw new BadRequestException(
        `Posting attempt ${id} is ${row.status}; only a FAILED posting can be re-queued`,
      );
    }
    row.status = GlPostingStatus.PENDING;
    row.attempts = 0;
    await em.flush();
    return row;
  }
}

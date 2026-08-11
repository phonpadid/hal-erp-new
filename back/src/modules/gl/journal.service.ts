import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountRoleType, GlPostingStatus } from '../../common/enums';
import { Money } from '../../common/money/money';
import { paginate, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Document } from '../document/document.entities';
import { GlPostingAttempt } from './gl-posting.entities';
import { SOURCE_ACCRUAL, SOURCE_PAYMENT } from './gl-posting.service';
import { AccountRole, JournalEntry } from './gl.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/** One unpaid trade payable, derived from the journal rather than stored. */
export interface OpenPayable {
  documentId: string;
  documentNo: string | null;
  vendorId: string | null;
  vendorName: string | null;
  amount: string;
  invoiceDate: string;
  dueDate: string;
}

/** `YYYY-MM-DD` plus n days. The invoice date is already a company-day string (see gl-journal). */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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
   * The payables this company owes and has not paid.
   *
   * Derived, not stored (design D4): a payable is open when an approval accrual credited
   * `ACCOUNTS_PAYABLE` for a document and no payment entry exists for the same source.
   * `payment.document_id` is unique — a document is paid exactly once — so there is no partial
   * state a subledger table would be needed to hold, and a derived read cannot drift from the
   * journal because it is read from it.
   *
   * A `CLAIM_PAYABLE` accrual is excluded: it is owed to a person, not a vendor, and it is cleared
   * by a recorded settlement rather than by a payment.
   */
  async openPayables(q: PaginationQueryDto = {}): Promise<Paginated<OpenPayable>> {
    const em = this.companyScope.forActiveCompany();
    const apRole = await em.findOne(
      AccountRole,
      { role: AccountRoleType.ACCOUNTS_PAYABLE },
      { populate: ['account'] },
    );
    // No trade-payable account mapped means nothing can have been accrued to one.
    if (!apRole) return { items: [], total: 0, page: 1, limit: 0 };

    const accruals = await em.find(
      JournalEntry,
      { sourceType: SOURCE_ACCRUAL },
      { populate: ['lines', 'lines.account'], orderBy: { entryDate: 'ASC' } },
    );
    if (!accruals.length) return { items: [], total: 0, page: 1, limit: 0 };

    const sourceIds = accruals.map((a) => a.sourceId);
    const paid = new Set(
      (await em.find(JournalEntry, { sourceType: SOURCE_PAYMENT, sourceId: { $in: sourceIds } }))
        .map((e) => e.sourceId),
    );
    const docs = await em.find(
      Document,
      { id: { $in: sourceIds } },
      { ...FILTER_OFF, populate: ['vendor'] },
    );
    const docById = new Map(docs.map((d) => [d.id, d]));

    const items: OpenPayable[] = [];
    for (const accrual of accruals) {
      if (paid.has(accrual.sourceId)) continue;
      const credited = accrual.lines
        .getItems()
        .filter((l) => l.account.id === apRole.account.id)
        .reduce((s, l) => Money.add(s, l.credit), '0');
      // A claim's accrual credits CLAIM_PAYABLE, so it contributes nothing here and drops out.
      if (Money.compare(credited, '0') <= 0) continue;
      const doc = docById.get(accrual.sourceId);
      items.push({
        documentId: accrual.sourceId,
        documentNo: doc?.docNo ?? null,
        vendorId: doc?.vendor?.id ?? null,
        vendorName: doc?.vendor?.name ?? null,
        amount: credited,
        invoiceDate: accrual.entryDate,
        dueDate: addDays(accrual.entryDate, doc?.vendor?.paymentTermDays ?? 0),
      });
    }
    return { items, total: items.length, page: 1, limit: items.length };
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

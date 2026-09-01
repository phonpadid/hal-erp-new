import type { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { GlPostingStatus } from '../../common/enums';
import { PAYABLE_KINDS, payableAccountsOf, type PayableKind } from './payables';
import { Money } from '../../common/money/money';
import { paginate, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { localDateIn } from '../../common/time/company-clock';
import { RequestContext } from '../../common/context/request-context';
import { Company } from '../multi-company/multi-company.entities';
import { Budget } from '../budget/budget.entities';
import { Document } from '../document/document.entities';
import { GlPostingAttempt } from './gl-posting.entities';
import { chargedDocumentIdOf, SOURCE_ACCRUAL, SOURCE_PAYMENT } from './gl-posting.service';
import { AccountRole, JournalEntry } from './gl.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/** One unpaid trade payable, derived from the journal rather than stored. */
/**
 * How late a payable is. Named by the boundary each band ends at, and measured from the DUE date —
 * "overdue" means past the date payment was due. Ageing from the invoice date would put a payable
 * on sixty-day terms into a band the day it was raised, which reads as late when nothing is.
 */
export type AgeingBucket = 'NOT_DUE' | 'D1_30' | 'D31_60' | 'D61_90' | 'D90_PLUS';

export interface OpenPayable {
  documentId: string;
  documentNo: string | null;
  /** `TRADE` is owed to a supplier, `CLAIM` to a person. IAS 1's "trade and other payables". */
  payableKind: PayableKind;
  /** Who is owed. Absent when the document names neither a vendor nor a related person. */
  owedTo: string | null;
  vendorId: string | null;
  vendorName: string | null;
  amount: string;
  invoiceDate: string;
  dueDate: string;
  /** Zero when not yet due. Measured against the COMPANY's day, resolved once per read. */
  daysOverdue: number;
  bucket: AgeingBucket;
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD` company-days. No instants, no offsets. */
function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

function bucketFor(daysOverdue: number): AgeingBucket {
  if (daysOverdue <= 0) return 'NOT_DUE';
  if (daysOverdue <= 30) return 'D1_30';
  if (daysOverdue <= 60) return 'D31_60';
  if (daysOverdue <= 90) return 'D61_90';
  return 'D90_PLUS';
}

export const AGEING_BUCKETS: AgeingBucket[] = ['NOT_DUE', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'];

/** One expense that exists in the world and in neither book: skipped because no budget was charged. */
export interface SkippedForWantOfBudget {
  id: string;
  sourceType: string;
  sourceId: string;
  documentId: string;
  documentNo: string;
  documentStatus: string;
  baseTotalAmount: string | null;
  lastAttemptAt: Date | null;
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
  ): Promise<
    Paginated<
      GlPostingAttempt & {
        sourceDocNo?: string;
        blockedByBudgetCode?: string;
        blockedByBudgetName?: string;
      }
    >
  > {
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

    /**
     * The blocking budget by the code a person knows it as, not by its uuid.
     *
     * `blocked_by_budget_id` records the one cause that has a fix — a budget naming no GL account —
     * and the fix is applied on the budget, so the row has to say WHICH. One query for the page,
     * matching the doc-number resolution above; a per-row lookup would turn a fifty-row list into a
     * hundred round trips for a column most rows leave empty.
     */
    const budgetIds = [...new Set(page.items.map((r) => r.blockedByBudget?.id).filter((id): id is string => !!id))];
    const blockers = budgetIds.length
      ? await em.find(Budget, { id: { $in: budgetIds } }, { ...FILTER_OFF, populate: ['node'] })
      : [];
    const blockerById = new Map(blockers.map((b) => [b.id, b]));

    return {
      ...page,
      items: page.items.map((r) => {
        const blocker = r.blockedByBudget ? blockerById.get(r.blockedByBudget.id) : undefined;
        return Object.assign(r, {
          sourceDocNo: docNoById.get(r.sourceId),
          blockedByBudgetCode: blocker?.node.code,
          blockedByBudgetName: blocker?.node.name ?? blocker?.budgetName,
        });
      }),
    };
  }

  /**
   * The expenses that were never written to the ledger because nothing had been charged to a budget.
   *
   * A SEPARATE read from `undelivered` above, deliberately, and it does NOT change it. `SKIPPED`
   * stays terminal there for the reason it always did: the period close asks that read whether a
   * month is drained, and a month must not be blocked by a posting the engine already decided not to
   * write. The two ask different questions — that one asks what the engine still OWES, this asks
   * what the engine decided not to SAY. Nothing here gates, blocks or delays a close.
   *
   * It exists because the budget-to-ledger reconciliation cannot see this case: a document with no
   * budget produces no `ACTUAL` and no journal entry, so both books report zero, the difference is
   * zero, and a reconciliation without this read would certify the books at the exact moment an
   * entire expense is absent from both.
   *
   * The classification is DERIVED at read time rather than stored (design D5). `gl_posting_attempt`
   * records no reason, so "the amount was zero, so there was nothing to post" and "there was no
   * budget, so there was no expense side" are written identically. A `SKIPPED` row whose document
   * charged no budget is the second kind — the same rule the posting engine used, and no write.
   *
   * A skip whose source is not a document at all (a RESERVE stock movement, an intra-company
   * transfer) drops out: nothing is owed to anybody, so there is no missing expense to report.
   */
  async skippedForWantOfBudget(): Promise<SkippedForWantOfBudget[]> {
    const em = this.companyScope.forActiveCompany();
    const skipped = await em.find(
      GlPostingAttempt,
      { status: GlPostingStatus.SKIPPED },
      { orderBy: { createdAt: 'ASC' } },
    );
    if (!skipped.length) return [];

    const docs = await em.find(
      Document,
      { id: { $in: skipped.map((s) => s.sourceId) } },
      FILTER_OFF,
    );
    const docById = new Map(docs.map((d) => [d.id, d]));

    const rows: SkippedForWantOfBudget[] = [];
    for (const attempt of skipped) {
      const doc = docById.get(attempt.sourceId);
      if (!doc) continue;
      // The same reference-chain walk the posting engine made: a chained settlement's budget hold
      // lives on the ancestor, and a document that charged one there was not skipped for want of a
      // budget.
      if (await chargedDocumentIdOf(em, doc.id)) continue;
      rows.push({
        id: attempt.id,
        sourceType: attempt.sourceType,
        sourceId: attempt.sourceId,
        documentId: doc.id,
        documentNo: doc.docNo,
        documentStatus: doc.status as string,
        baseTotalAmount: doc.baseTotalAmount ?? null,
        lastAttemptAt: attempt.lastAttemptAt ?? null,
      });
    }
    return rows;
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
  /**
   * The active company's calendar day.
   *
   * Ageing is a question about today, and "today" is the company's, not the server's and not the
   * viewer's browser's. Same resolution `createEntry` uses to date an entry, for the same reason: a
   * day taken in UTC lands on the wrong side of midnight for seven hours at every cut-off.
   */
  private async companyDay(em: EntityManager): Promise<string> {
    const companyId = RequestContext.companyId()!;
    const company = await em.findOneOrFail(Company, { id: companyId }, FILTER_OFF);
    return localDateIn(new Date(), company.timezone);
  }

  /**
   * The ageing totals: how much is in each band, and how many payables.
   *
   * Derived from the same open payables and the same company day as the list, so the summary and
   * the rows cannot disagree. Computed here rather than reduced on the client because the client
   * holds whatever page it happens to have, and a total over a subset is a number whose meaning
   * changes when the page does.
   */
  async payablesAgeing(): Promise<{
    agedAt: string;
    buckets: Array<{ bucket: AgeingBucket; total: string; count: number }>;
    byKind: Array<{ payableKind: PayableKind; total: string; count: number }>;
    total: string;
  }> {
    const { items } = await this.openPayables({ limit: Number.MAX_SAFE_INTEGER });
    const buckets = AGEING_BUCKETS.map((bucket) => {
      const rows = items.filter((i) => i.bucket === bucket);
      return {
        bucket,
        total: rows.reduce((t, r) => Money.add(t, r.amount), '0'),
        count: rows.length,
      };
    });
    // What the overall total is COMPOSED of. IAS 1 asks for "trade and other payables" as a reported
    // total whose composition is disclosed — two requirements, not one. Every kind is reported even
    // at zero: absent, a reader cannot tell "nothing is owed to people" from "nobody looked".
    // Derived from the same rows as the buckets, so the two partitions of one set always agree.
    const byKind = PAYABLE_KINDS.map(({ kind }) => {
      const rows = items.filter((i) => i.payableKind === kind);
      return {
        payableKind: kind,
        total: rows.reduce((t, r) => Money.add(t, r.amount), '0'),
        count: rows.length,
      };
    });
    return {
      agedAt: await this.companyDay(this.companyScope.forActiveCompany()),
      buckets,
      byKind,
      total: buckets.reduce((t, b) => Money.add(t, b.total), '0'),
    };
  }

  async openPayables(q: PaginationQueryDto = {}): Promise<Paginated<OpenPayable>> {
    const em = this.companyScope.forActiveCompany();
    const companyId = RequestContext.companyId()!;
    const agedAt = await this.companyDay(em);
    // Every payable account the company maps, by kind. A role it has not mapped contributes
    // nothing rather than raising: no accrual can have credited an account that does not exist,
    // and `CLAIM_PAYABLE` is mapped only by a company that pays people — a read that failed
    // without it would take the trade ageing down with it.
    const payableAccounts = await payableAccountsOf(em, companyId);
    if (!payableAccounts.size) return { items: [], total: 0, page: 1, limit: 0 };

    const accruals = await em.find(
      JournalEntry,
      { sourceType: SOURCE_ACCRUAL },
      { populate: ['lines', 'lines.account'], orderBy: { entryDate: 'ASC' } },
    );
    if (!accruals.length) return { items: [], total: 0, page: 1, limit: 0 };

    const sourceIds = accruals.map((a) => a.sourceId);
    // Cleared by ONE thing now, whoever was owed: the payment entry. A claim used to be cleared by
    // a settlement entry of its own, which is the second path this change removed.
    const paid = new Set(
      (await em.find(JournalEntry, { sourceType: SOURCE_PAYMENT, sourceId: { $in: sourceIds } }))
        .map((e) => e.sourceId),
    );
    const docs = await em.find(
      Document,
      { id: { $in: sourceIds } },
      { ...FILTER_OFF, populate: ['vendor', 'relatedEmployee'] },
    );
    const docById = new Map(docs.map((d) => [d.id, d]));

    const items: OpenPayable[] = [];
    for (const accrual of accruals) {
      if (paid.has(accrual.sourceId)) continue;
      // Which payable this is comes from the account the accrual CREDITED, not from whether the
      // document carries a vendor: the accrual made that decision and wrote it into the ledger,
      // and re-deriving it from the document would be a second opinion about a fact the entry
      // records.
      let kind: PayableKind | null = null;
      let credited = '0';
      for (const line of accrual.lines.getItems()) {
        const lineKind = payableAccounts.get(line.account.id);
        if (!lineKind || Money.compare(line.credit, '0') <= 0) continue;
        kind = lineKind;
        credited = Money.add(credited, line.credit);
      }
      if (!kind || Money.compare(credited, '0') <= 0) continue;
      const doc = docById.get(accrual.sourceId);
      // A claim has no supplier and therefore no terms: payment terms are an arrangement with a
      // vendor, and nobody negotiated one on behalf of a person whose compensation was approved.
      // They are owed it now — so a claim is due the day its obligation was raised. A default term
      // would report a credit agreement that does not exist, and no due date at all would keep the
      // company's oldest debts permanently out of every band.
      //
      // The branch AGREES with the fallback today and no test can tell them apart: a claim carries
      // no vendor, so `?? 0` already lands on the accrual date. It is written out anyway because
      // the rule is about claims, not about the absence of a vendor — the day a company default
      // term is added to that fallback, claims must not quietly acquire one.
      const dueDate =
        kind === 'CLAIM' ? accrual.entryDate : addDays(accrual.entryDate, doc?.vendor?.paymentTermDays ?? 0);
      // Against the COMPANY's day, resolved once above: a request that spans midnight there must
      // not put two payables of the same due date in different buckets.
      const daysOverdue = Math.max(0, daysBetween(dueDate, agedAt));
      items.push({
        documentId: accrual.sourceId,
        documentNo: doc?.docNo ?? null,
        payableKind: kind,
        // The vendor, or the person the document relates to. Never the document's author: whoever
        // raised a claim is frequently not whoever is owed it, and naming the wrong payee is worse
        // than naming none — the document number identifies the row either way.
        owedTo: doc?.vendor?.name ?? doc?.relatedEmployee?.fullName ?? null,
        vendorId: doc?.vendor?.id ?? null,
        vendorName: doc?.vendor?.name ?? null,
        amount: credited,
        invoiceDate: accrual.entryDate,
        dueDate,
        daysOverdue,
        bucket: bucketFor(daysOverdue),
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

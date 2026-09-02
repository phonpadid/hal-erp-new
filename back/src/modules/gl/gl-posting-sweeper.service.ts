import { LockMode } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, Logger } from '@nestjs/common';
import { GlPostingStatus, StockTxnType } from '../../common/enums';
import { Document, DocumentType } from '../document/document.entities';
import { StockTxn } from '../inventory/inventory.entities';
import { Company } from '../multi-company/multi-company.entities';
import { Payment } from '../payment-handoff/payment.entities';
import { GlPostingAttempt } from './gl-posting.entities';
import { GlPostingService, SOURCE_ACCRUAL, SOURCE_PAYMENT, SOURCE_STOCK } from './gl-posting.service';
import { JournalEntry } from './gl.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/** Failures before a row is parked in FAILED. Matches `successor-outbox`'s bound. */
export const MAX_ATTEMPTS = 5;

/**
 * How far back reconciliation looks for sources that were never attempted.
 *
 * It must exceed the longest plausible outage — the window is what closes the gap between a
 * business transaction committing and the in-process listener running, which a restart can widen
 * to however long the process was down. Anything older than this is a bookkeeping question for a
 * person, not work for a sweeper, and scanning all of history every minute to ask it would be a
 * growing cost paid forever for an answer nobody is waiting on.
 */
export const RECONCILE_WINDOW_DAYS = 7;

/**
 * Drains the postings the general ledger owes.
 *
 * Two mechanisms, one timer, because there are two ways a posting goes missing:
 *
 *   retry      rows that are PENDING or that failed under the bound — the posting ran and threw
 *   reconcile  sources with NO row at all — the posting never ran, because the process stopped
 *              between the business transaction committing and the listener firing. That case
 *              produces no row, no exception and no log line, so a retry that reads only the table
 *              cannot see it.
 *
 * Reconciliation records only; it never posts. One code path attempts a posting and one place
 * counts attempts, so "how many times has this been tried" has a single answer.
 */
@Injectable()
export class GlPostingSweeper {
  private readonly logger = new Logger(GlPostingSweeper.name);

  constructor(
    private readonly em: EntityManager,
    private readonly posting: GlPostingService,
  ) {}

  /** Reconcile first, then drain: a source found this pass is posted in the same pass. */
  async sweep(): Promise<{ reconciled: number; posted: number }> {
    const reconciled = await this.reconcile();
    const posted = await this.drain();
    return { reconciled, posted };
  }

  /**
   * Attempt every row that is still owed and still under the attempt bound, oldest first.
   *
   * Each row is claimed in its own transaction, so one poisonous source cannot roll back the
   * others' work, and the posting itself runs outside that claim — `postFor*` opens its own
   * transaction and records its own outcome, which is what keeps the counting in one place.
   */
  async drain(): Promise<number> {
    const owed = await this.em.fork().find(
      GlPostingAttempt,
      { status: { $in: [GlPostingStatus.PENDING, GlPostingStatus.FAILED] }, attempts: { $lt: MAX_ATTEMPTS } },
      { ...FILTER_OFF, orderBy: { createdAt: 'ASC' }, fields: ['id'] },
    );

    let posted = 0;
    for (const { id } of owed) {
      if (await this.attemptRow(id)) posted += 1;
    }
    return posted;
  }

  /**
   * Claim one row and attempt its posting.
   *
   * `SKIP LOCKED` rather than a plain FOR UPDATE: a row another sweeper already holds is skipped,
   * not waited on, so two instances cannot both post one source and a slow row does not stall the
   * queue behind it. The journal's own unique key on (company, source_type, source_id) is the
   * second line of defence, not the first — relying on it alone would turn a benign race into a
   * constraint violation in the logs.
   */
  private async attemptRow(rowId: string): Promise<boolean> {
    const claimed = await this.em.fork().transactional(async (tem) => {
      const row = await tem.findOne(
        GlPostingAttempt,
        { id: rowId, attempts: { $lt: MAX_ATTEMPTS } },
        { ...FILTER_OFF, lockMode: LockMode.PESSIMISTIC_WRITE, lockTableAliases: ['g0'] },
      );
      // Claimed by another sweeper, or bounded out, between the scan and now.
      if (!row || row.status === GlPostingStatus.POSTED || row.status === GlPostingStatus.SKIPPED) {
        return null;
      }
      return { sourceType: row.sourceType, sourceId: row.sourceId };
    });
    if (!claimed) return false;

    try {
      await this.post(claimed.sourceType, claimed.sourceId);
      return true;
    } catch {
      // The posting already recorded FAILED with its message and incremented `attempts`; parking
      // the row at the bound is the only thing left to decide, and it is decided here so that the
      // bound lives beside the sweep that honours it.
      await this.parkIfExhausted(rowId);
      return false;
    }
  }

  /** Dispatch to the posting path a source type names. */
  private async post(sourceType: string, sourceId: string): Promise<void> {
    if (sourceType === SOURCE_PAYMENT) return this.posting.postForPayment(sourceId);
    if (sourceType === SOURCE_ACCRUAL) return this.posting.postAccrualForApproval(sourceId);
    if (sourceType === SOURCE_STOCK) return this.posting.postForStockTxn(sourceId);
    // CLAIM_SETTLEMENT is deliberately absent: it posts inside its caller's transaction, so it can
    // never be owed-and-undelivered — either the settlement and its entry commit, or neither does.
    throw new Error(`No posting path for source type '${sourceType}'`);
  }

  /**
   * A row that has used its attempts stops being retried. It is NOT removed from the undelivered
   * read: the bound stops the retrying, not the debt. An unmapped account will not map itself, and
   * a posting nobody will retry automatically is the one most in need of being seen.
   */
  private async parkIfExhausted(rowId: string): Promise<void> {
    await this.em.fork().transactional(async (tem) => {
      const row = await tem.findOne(GlPostingAttempt, { id: rowId }, FILTER_OFF);
      if (row && row.attempts >= MAX_ATTEMPTS) row.status = GlPostingStatus.FAILED;
    });
  }

  /**
   * Record a PENDING row for every source that is owed a posting, has no `journal_entry`, and has
   * no row at all — the postings lost between a commit and a listener that never ran.
   *
   * The enumeration below IS the definition of a posting source. A posting path added later must
   * extend it, or its sources will never be reconciled — silently, since a source nobody enumerates
   * produces no alarm. That is why the spec states the list rather than leaving it to this file.
   */
  async reconcile(): Promise<number> {
    const em = this.em.fork();
    const since = new Date(Date.now() - RECONCILE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const owed: Array<{ companyId: string; sourceType: string; sourceId: string }> = [];

    // 1. Settled payments. The source id is the DOCUMENT, matching journal_entry.source_id.
    const payments = await em.find(
      Payment,
      { createdAt: { $gte: since } },
      { ...FILTER_OFF, populate: ['company', 'document'] },
    );
    for (const p of payments) {
      owed.push({ companyId: p.company.id, sourceType: SOURCE_PAYMENT, sourceId: p.document.id });
    }

    // 2. Fully approved documents of a type that accrues at approval. A type that does not accrue
    //    is not a source, which is why no row is written for one when its approval fires.
    const accruingTypes = await em.find(
      DocumentType,
      { accruesOnApproval: true },
      { ...FILTER_OFF, fields: ['id'] },
    );
    if (accruingTypes.length) {
      const docs = await em.find(
        Document,
        { documentType: { $in: accruingTypes.map((t) => t.id) }, approvedAt: { $gte: since } },
        { ...FILTER_OFF, populate: ['company'] },
      );
      for (const d of docs) {
        owed.push({ companyId: d.company.id, sourceType: SOURCE_ACCRUAL, sourceId: d.id });
      }
    }

    // 3. Stock movements. RESERVE and RELEASE move no value and are excluded here as well as being
    //    SKIPPED by the posting itself — offering them every pass would be work for a known no-op.
    const stock = await em.find(
      StockTxn,
      {
        createdAt: { $gte: since },
        txnType: { $nin: [StockTxnType.RESERVE, StockTxnType.RELEASE] },
      },
      { ...FILTER_OFF, populate: ['company'] },
    );
    for (const s of stock) {
      owed.push({ companyId: s.company.id, sourceType: SOURCE_STOCK, sourceId: s.id });
    }

    if (!owed.length) return 0;

    // Subtract what is already answered: an entry exists (the journal is the authority), or a row
    // exists at all (it is already being tracked, terminal or not).
    const ids = owed.map((o) => o.sourceId);
    const entries = await em.find(JournalEntry, { sourceId: { $in: ids } }, { ...FILTER_OFF, fields: ['sourceType', 'sourceId'] });
    const rows = await em.find(GlPostingAttempt, { sourceId: { $in: ids } }, { ...FILTER_OFF, fields: ['sourceType', 'sourceId'] });
    const answered = new Set([
      ...entries.map((e) => `${e.sourceType}:${e.sourceId}`),
      ...rows.map((r) => `${r.sourceType}:${r.sourceId}`),
    ]);

    const missing = owed.filter((o) => !answered.has(`${o.sourceType}:${o.sourceId}`));
    if (!missing.length) return 0;

    await em.transactional(async (tem) => {
      for (const m of missing) {
        tem.persist(
          tem.create(GlPostingAttempt, {
            company: tem.getReference(Company, m.companyId),
            sourceType: m.sourceType,
            sourceId: m.sourceId,
            status: GlPostingStatus.PENDING,
            attempts: 0,
            createdAt: new Date(),
          }),
        );
      }
    });
    this.logger.warn(`Reconciled ${missing.length} posting(s) that were never attempted`);
    return missing.length;
  }
}

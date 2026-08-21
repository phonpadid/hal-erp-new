import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { AccountType, BudgetTxnType } from '../../common/enums';
import { Money } from '../../common/money/money';
import { localDateIn } from '../../common/time/company-clock';
import { Account } from '../accounting/accounting.entities';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { Document } from '../document/document.entities';
import { chargedDocumentIdOf, SOURCE_MANUAL } from '../gl/gl-posting.service';
import { JournalEntry, JournalLine } from '../gl/gl.entities';
import { JournalVoucher } from '../gl/journal-voucher.entities';
import { Company, FiscalYear } from '../multi-company/multi-company.entities';
import { BudgetLedgerReconciliationQueryDto } from './dto/report-filters.dto';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The direction an account's balance moves. ASSET/EXPENSE are debit-normal, the rest credit-normal.
 *
 * Movement is taken in this direction rather than as an absolute (design D2): an expense account a
 * reversal credited moved BACKWARDS, and reporting that as movement would hide exactly the case
 * worth seeing. Same rule `financial-reports` uses for its normal balances, for the same reason.
 */
function directionOf(type: AccountType): 1 | -1 {
  return type === AccountType.ASSET || type === AccountType.EXPENSE ? 1 : -1;
}

/** One named cause of an account's difference: what a source type moved without consuming budget. */
export interface ReconciliationCause {
  sourceType: string;
  amount: string;
}

/** One document whose consumption fell outside the year of the appropriation it drew on. */
export interface CrossingConsumption {
  documentId: string;
  documentNo: string | null;
  /** The day the consumption was dated — outside `[fy.startDate, fy.endDate]`. */
  txnDate: string;
  amount: string;
}

export interface ReconciliationRow {
  /** Null when the budget's `gl_account` resolves to no account row — the ledger side is then 0. */
  accountId: string | null;
  accountCode: string;
  accountName: string | null;
  /** Σ amount_total + ADJUST_INCREASE − ADJUST_DECREASE + TRANSFER_IN − TRANSFER_OUT */
  appropriated: string;
  /** Σ RESERVE − Σ RELEASE − Σ ACTUAL — the outstanding reservation (invariant 3) */
  committed: string;
  /** Σ ACTUAL — the figure being reconciled */
  consumed: string;
  /** The ledger's movement over the fiscal year, in the account's natural direction */
  moved: string;
  /** moved − consumed */
  difference: string;
  sourcesWithoutBudget: ReconciliationCause[];
  sourcesWithoutBudgetTotal: string;
  capitalisedIntoStock: string;
  postingNeverArrived: string;
  /**
   * Consumption charged to THIS year's appropriation on a day BEFORE the year began. Reported apart
   * from its late twin because an early arrival and a late one are different facts about a cutoff
   * and net to nothing when added.
   */
  consumedBeforeItsYear: string;
  /** …and on a day AFTER the year ended. */
  consumedAfterItsYear: string;
  /** The documents behind both figures — the question the number provokes is which ones. */
  crossings: CrossingConsumption[];
  /** How many crossings there are in total, when the list above is capped. */
  crossingCount: number;
  /**
   * difference − sourcesWithoutBudgetTotal + capitalisedIntoStock + postingNeverArrived
   *            + consumedBeforeItsYear + consumedAfterItsYear
   */
  unexplained: string;
}

/** How many crossing documents an account lists before the report reports a count instead. */
const CROSSINGS_SHOWN = 10;

export interface VoucherOnBudgetedAccount {
  entryId: string;
  entryDate: string;
  /** The voucher document's number. Null if the entry's voucher row could not be resolved. */
  docNo: string | null;
  memo: string | null;
  /** What this voucher CHARGED to budgeted accounts (see `vouchersOnBudgetedAccounts`). */
  amount: string;
}

export interface FiscalYearRef {
  id: string;
  year: number;
  startDate: string;
  endDate: string;
}

export interface BudgetLedgerReconciliation {
  fiscalYear: FiscalYearRef;
  /**
   * The years this report can be run for, newest first.
   *
   * Returned here rather than left to `GET /fiscal-years`, which requires `FISCAL_YEAR_MANAGE` —
   * a code the people who explain the difference in the financial statements have no reason to
   * hold. A screen that cannot offer the choice is a report that only ever shows one year.
   */
  fiscalYears: FiscalYearRef[];
  rows: ReconciliationRow[];
  vouchersOnBudgetedAccounts: { total: string; entries: VoucherOnBudgetedAccount[] };
}

/**
 * Budget against ledger, by account and fiscal year — the comparison neither `reporting` nor
 * `financial-reports` could make, because one reads only `budget_txn` and the other only
 * `journal_line`.
 *
 * READ-ONLY, absolutely: no `budget_txn`, no `journal_entry`, no stored reconciled figure. A stored
 * reconciliation would be a third opinion about facts two ledgers already hold.
 *
 * The account is the only axis (design D1): `journal_line` carries no department, and the entries
 * that CREATE the difference — a manual voucher, a revaluation, a year close — have no document to
 * recover one from.
 */
@Injectable()
export class BudgetLedgerReconciliationService {
  constructor(
    private readonly em: EntityManager,
    private readonly balance: BudgetBalanceService,
  ) {}

  async reconcile(f: BudgetLedgerReconciliationQueryDto = {}): Promise<BudgetLedgerReconciliation> {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    const years = await em.find(
      FiscalYear,
      { company: companyId },
      { ...FILTER_OFF, orderBy: { startDate: 'DESC' } },
    );
    const fy = await this.resolveFiscalYear(em, companyId, years, f.fiscalYearId);

    // Budget isn't company-scoped; scoping through the (already company-scoped) fiscal year is the
    // same route `budgetBalanceByDeptCategory` takes (invariant 1).
    const budgets = await em.find(Budget, { fiscalYear: fy.id }, FILTER_OFF);

    const keyInfo = new Map<string, { key: string; accountId: string | null; code: string; name: string | null; direction: 1 | -1 }>();
    const keyOfBudget = new Map<string, string>();
    await this.resolveAccounts(em, companyId, budgets, keyInfo, keyOfBudget);

    // ── The budget side ───────────────────────────────────────────────────────────────────────
    // Folded from `BudgetBalanceService.breakdown` rather than re-summed here, so this report and
    // the budget-balance report can never disagree about what a budget has taken (invariant 3).
    const budgetSide = new Map<string, { appropriated: string; committed: string; consumed: string }>();
    for (const b of budgets) {
      const key = keyOfBudget.get(b.id)!;
      const bd = await this.balance.breakdown(b.id, em);
      const appropriated = Money.subtract(
        Money.add(Money.add(bd.amountTotal, bd.adjustIncrease), bd.transferIn),
        Money.add(bd.adjustDecrease, bd.transferOut),
      );
      const committed = Money.subtract(Money.subtract(bd.reserved, bd.released), bd.actual);
      const cur = budgetSide.get(key) ?? { appropriated: '0', committed: '0', consumed: '0' };
      cur.appropriated = Money.add(cur.appropriated, appropriated);
      cur.committed = Money.add(cur.committed, committed);
      cur.consumed = Money.add(cur.consumed, bd.actual);
      budgetSide.set(key, cur);
    }

    // Σ ACTUAL per (account, document) — the per-document basis the capitalisation cause needs.
    const consumedByDoc = new Map<string, Map<string, string>>();
    const actuals = budgets.length
      ? await em.find(
          BudgetTxn,
          { budget: { $in: budgets.map((b) => b.id) }, txnType: BudgetTxnType.ACTUAL },
          FILTER_OFF,
        )
      : [];
    // Consumption dated outside the year of the appropriation it drew on, per account.
    //
    // The budget side stays grouped by `budget.fiscal_year` — an appropriation belongs to the year
    // it was voted for, and a row that consumes it belongs to that appropriation whatever day it
    // fell on. Bounding the budget side by `txn_date` instead would drop a crossing row from BOTH
    // years' reports (out of this one by the bound, out of the next because that report reads the
    // next year's budgets) and the reconciliation would balance by losing the evidence (design D3).
    const crossingsByKey = new Map<string, CrossingConsumption[]>();
    /** Per (account, document): how much of its consumption fell outside the appropriation's year. */
    const crossedByDoc = new Map<string, Map<string, string>>();
    for (const t of actuals) {
      const key = keyOfBudget.get(t.budget.id);
      const docId = t.document?.id;
      if (!key || !docId) continue;
      const m = consumedByDoc.get(key) ?? new Map<string, string>();
      m.set(docId, Money.add(m.get(docId) ?? '0', t.amount));
      consumedByDoc.set(key, m);

      if (t.txnDate < fy.startDate || t.txnDate > fy.endDate) {
        const list = crossingsByKey.get(key) ?? [];
        list.push({ documentId: docId, documentNo: null, txnDate: t.txnDate, amount: t.amount });
        crossingsByKey.set(key, list);
        // Taken off what the per-document causes see. A crossing satisfies "no entry inside this
        // year" exactly as a stranded document does, so without this the same money is claimed by
        // two causes and the remainder never reaches zero (design D2b). By AMOUNT, not by document:
        // one settled partly in December and partly in January belongs to both.
        const c = crossedByDoc.get(key) ?? new Map<string, string>();
        c.set(docId, Money.add(c.get(docId) ?? '0', t.amount));
        crossedByDoc.set(key, c);
      }
    }

    // Document numbers for the crossings, in one query rather than per row.
    const crossingDocIds = [...new Set([...crossingsByKey.values()].flat().map((c) => c.documentId))];
    const crossingDocs = crossingDocIds.length
      ? await em.find(Document, { id: { $in: crossingDocIds } }, FILTER_OFF)
      : [];
    const docNoById = new Map(crossingDocs.map((d) => [d.id, d.docNo]));
    for (const list of crossingsByKey.values()) {
      for (const c of list) c.documentNo = docNoById.get(c.documentId) ?? null;
      list.sort((a, b) => a.txnDate.localeCompare(b.txnDate) || a.documentId.localeCompare(b.documentId));
    }

    // ── The ledger side ───────────────────────────────────────────────────────────────────────
    // Bounded by `entry_date`, which `createEntry` already resolved in the posting company's own
    // timezone — so there is no instant left to convert and no UTC boundary to get wrong.
    const ledgerAccountIds = [...keyInfo.values()]
      .map((i) => i.accountId)
      .filter((id): id is string => !!id);
    const lines = ledgerAccountIds.length
      ? await em.find(
          JournalLine,
          {
            company: companyId,
            account: { $in: ledgerAccountIds },
            journalEntry: { entryDate: { $gte: fy.startDate, $lte: fy.endDate } },
          },
          { ...FILTER_OFF, populate: ['journalEntry'] },
        )
      : [];

    // Which budget consumption, if any, each entry's source came from. Resolved once per source.
    const entryById = new Map<string, JournalEntry>();
    for (const l of lines) entryById.set(l.journalEntry.id, l.journalEntry);
    const chargedBySource = new Map<string, string | null>();
    for (const e of entryById.values()) {
      if (chargedBySource.has(e.sourceId)) continue;
      chargedBySource.set(e.sourceId, await chargedDocumentIdOf(em, e.sourceId));
    }

    const moved = new Map<string, string>();
    const noBudget = new Map<string, Map<string, string>>();
    const postedInFy = new Map<string, Map<string, string>>();
    const voucherByAccount = new Map<string, Map<string, string>>();
    for (const l of lines) {
      const info = keyInfo.get(l.account.id);
      if (!info) continue;
      const m =
        info.direction === 1
          ? Money.subtract(l.debit, l.credit)
          : Money.subtract(l.credit, l.debit);
      moved.set(info.key, Money.add(moved.get(info.key) ?? '0', m));

      const entry = l.journalEntry;
      const charged = chargedBySource.get(entry.sourceId) ?? null;
      if (charged) {
        const p = postedInFy.get(info.key) ?? new Map<string, string>();
        p.set(charged, Money.add(p.get(charged) ?? '0', m));
        postedInFy.set(info.key, p);
      } else {
        const n = noBudget.get(info.key) ?? new Map<string, string>();
        n.set(entry.sourceType, Money.add(n.get(entry.sourceType) ?? '0', m));
        noBudget.set(info.key, n);
      }
      if (entry.sourceType === SOURCE_MANUAL) {
        const v = voucherByAccount.get(entry.id) ?? new Map<string, string>();
        v.set(info.key, Money.add(v.get(info.key) ?? '0', m));
        voucherByAccount.set(entry.id, v);
      }
    }

    const chargedDocs = new Set<string>();
    for (const m of consumedByDoc.values()) for (const d of m.keys()) chargedDocs.add(d);
    const posted = await this.documentsWhosePostingArrived(em, companyId, chargedDocs, postedInFy);

    // ── The decomposition ─────────────────────────────────────────────────────────────────────
    const rows: ReconciliationRow[] = [];
    for (const info of keyInfo.values()) {
      const b = budgetSide.get(info.key) ?? { appropriated: '0', committed: '0', consumed: '0' };
      const movedTotal = moved.get(info.key) ?? '0';
      const difference = Money.subtract(movedTotal, b.consumed);

      const causes = [...(noBudget.get(info.key) ?? new Map<string, string>())]
        .map(([sourceType, amount]) => ({ sourceType, amount }))
        .sort((x, y) => x.sourceType.localeCompare(y.sourceType));
      const causesTotal = causes.reduce((s, c) => Money.add(s, c.amount), '0');

      let capitalised = '0';
      let neverArrived = '0';
      const perDoc = consumedByDoc.get(info.key) ?? new Map<string, string>();
      const postedOnAccount = postedInFy.get(info.key) ?? new Map<string, string>();
      const crossedOnAccount = crossedByDoc.get(info.key) ?? new Map<string, string>();
      for (const [docId, totalOnAccount] of perDoc) {
        // Only what stayed inside the year is this loop's business; the rest is already explained.
        const consumedOnAccount = Money.subtract(totalOnAccount, crossedOnAccount.get(docId) ?? '0');
        if (Money.compare(consumedOnAccount, '0') <= 0) continue;
        if (!posted.has(docId)) {
          // The money went NOWHERE: budget charged, no journal entry at all.
          neverArrived = Money.add(neverArrived, consumedOnAccount);
          continue;
        }
        // The money went ELSEWHERE: the posting engine diverted the stock-tracked share to GRNI, so
        // the ACTUAL on this account exceeds what this document's entries debited here. Taken as
        // that difference rather than re-derived from the stock lines — the engine already decided
        // the split, and a second derivation would be free to disagree with it (design D3).
        const debited = postedOnAccount.get(docId) ?? '0';
        if (Money.compare(consumedOnAccount, debited) > 0) {
          capitalised = Money.add(capitalised, Money.subtract(consumedOnAccount, debited));
        }
      }

      // Signed apart: money charged to this year's pot on a day before it began, and on a day after
      // it ended, are different facts about a cutoff.
      const crossings = crossingsByKey.get(info.key) ?? [];
      let before = '0';
      let after = '0';
      for (const c of crossings) {
        if (c.txnDate < fy.startDate) before = Money.add(before, c.amount);
        else after = Money.add(after, c.amount);
      }

      rows.push({
        accountId: info.accountId,
        accountCode: info.code,
        accountName: info.name,
        appropriated: b.appropriated,
        committed: b.committed,
        consumed: b.consumed,
        moved: movedTotal,
        difference,
        sourcesWithoutBudget: causes,
        sourcesWithoutBudgetTotal: causesTotal,
        capitalisedIntoStock: capitalised,
        postingNeverArrived: neverArrived,
        consumedBeforeItsYear: before,
        consumedAfterItsYear: after,
        crossings: crossings.slice(0, CROSSINGS_SHOWN),
        crossingCount: crossings.length,
        // What remains AFTER the named causes, computed from the figures actually reported rather
        // than accumulated separately — so the decomposition the reader adds up is the one the
        // remainder was taken from. Any value but zero is a cause this report does not model.
        unexplained: Money.add(
          Money.add(
            Money.add(Money.subtract(difference, causesTotal), capitalised),
            neverArrived,
          ),
          // `consumed` is subtracted to form `difference`, so consumption that should not have
          // counted for this year is added back — the sign follows every other cause.
          Money.add(before, after),
        ),
      });
    }
    rows.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

    const ref = (y: FiscalYear): FiscalYearRef => ({
      id: y.id, year: y.year, startDate: y.startDate, endDate: y.endDate,
    });
    return {
      fiscalYear: ref(fy),
      fiscalYears: years.map(ref),
      rows,
      vouchersOnBudgetedAccounts: await this.vouchers(em, entryById, voucherByAccount),
    };
  }

  /**
   * The vouchers-on-budgeted-accounts figure and the vouchers behind it (design D6).
   *
   * A voucher's amount is what it CHARGED to budgeted accounts — the sum of its POSITIVE movements,
   * not the net. A voucher that debits one budgeted account and credits another nets to zero across
   * them while having moved expense between two ceilings with no availability check consulted for
   * either, which is precisely the path this figure exists to measure.
   *
   * Reported as a figure, never as an error: a company that budgets for depreciation would expect
   * its monthly voucher here, and one that does not would expect the opposite. Which is intended is
   * a policy this report does not hold.
   */
  private async vouchers(
    em: EntityManager,
    entryById: Map<string, JournalEntry>,
    voucherByAccount: Map<string, Map<string, string>>,
  ): Promise<{ total: string; entries: VoucherOnBudgetedAccount[] }> {
    const entries = [...entryById.values()].filter((e) => e.sourceType === SOURCE_MANUAL);
    // A voucher touching only unbudgeted accounts never reached `lines`, so it is absent already.
    if (!entries.length) return { total: '0', entries: [] };

    // MANUAL_JV's source id IS the voucher's id (`post-action.service`), whose document carries the
    // number a reader can look the voucher up by.
    const vouchers = await em.find(
      JournalVoucher,
      { id: { $in: entries.map((e) => e.sourceId) } },
      { ...FILTER_OFF, populate: ['document'] },
    );
    const docNoById = new Map(vouchers.map((v) => [v.id, v.document.docNo]));

    const rows = entries
      .map((e) => {
        let charged = '0';
        for (const m of (voucherByAccount.get(e.id) ?? new Map<string, string>()).values()) {
          if (Money.compare(m, '0') > 0) charged = Money.add(charged, m);
        }
        return {
          entryId: e.id,
          entryDate: e.entryDate,
          docNo: docNoById.get(e.sourceId) ?? null,
          memo: e.memo ?? null,
          amount: charged,
        };
      })
      .filter((r) => Money.compare(r.amount, '0') > 0)
      .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.entryId.localeCompare(b.entryId));

    return { total: rows.reduce((s, r) => Money.add(s, r.amount), '0'), entries: rows };
  }

  /**
   * Of the documents that charged a budget, which ones a posting actually reached.
   *
   * Two ways a document is known to have been posted, and both are needed:
   *
   *  · an entry inside the fiscal year was already attributed to it above — the ordinary case;
   *  · an entry exists for it or for a DESCENDANT of it. A chained settlement's entry is keyed on
   *    the document that was paid while the `ACTUAL` rows live on the ancestor that reserved, so a
   *    lookup by the ancestor's own id alone would report a posted purchase as never posted.
   *
   * Whatever is left over genuinely has no journal entry anywhere: the budget was charged and the
   * ledger never heard about it.
   */
  private async documentsWhosePostingArrived(
    em: EntityManager,
    companyId: string,
    chargedDocs: Set<string>,
    postedInFy: Map<string, Map<string, string>>,
  ): Promise<Set<string>> {
    const out = new Set<string>();
    for (const m of postedInFy.values()) for (const d of m.keys()) out.add(d);
    const pending = [...chargedDocs].filter((d) => !out.has(d));
    if (!pending.length) return out;

    // Walk DOWN the reference chain to collect every document that could carry the posting.
    const family = new Set<string>(pending);
    let frontier = pending;
    while (frontier.length) {
      const children = await em.find(
        Document,
        { company: companyId, refDocument: { $in: frontier } },
        FILTER_OFF,
      );
      frontier = [];
      for (const c of children) {
        if (family.has(c.id)) continue;
        family.add(c.id);
        frontier.push(c.id);
      }
    }

    const entries = await em.find(
      JournalEntry,
      { company: companyId, sourceId: { $in: [...family] } },
      FILTER_OFF,
    );
    for (const e of entries) {
      const charged = await chargedDocumentIdOf(em, e.sourceId);
      if (charged && chargedDocs.has(charged)) out.add(charged);
    }
    return out;
  }

  /** Resolve each budget to the account its ledger movement is read on, and remember the mapping. */
  private async resolveAccounts(
    em: EntityManager,
    companyId: string,
    budgets: Budget[],
    keyInfo: Map<string, { key: string; accountId: string | null; code: string; name: string | null; direction: 1 | -1 }>,
    keyOfBudget: Map<string, string>,
  ): Promise<void> {
    const ids = [...new Set(budgets.map((b) => b.account?.id).filter((id): id is string => !!id))];
    const codes = [...new Set(budgets.filter((b) => !b.account).map((b) => b.glAccount))];
    const byId = new Map(
      (ids.length ? await em.find(Account, { id: { $in: ids } }, FILTER_OFF) : []).map((a) => [a.id, a]),
    );
    // A budget written before `account_id` was backfilled still names its account by code.
    const byCode = new Map(
      (codes.length
        ? await em.find(
            Account,
            { company: companyId, code: { $in: codes.filter((c): c is string => !!c) } },
            FILTER_OFF,
          )
        : []
      ).map((a) => [a.code, a]),
    );

    for (const b of budgets) {
      // A budget may name no account at all now — one whose spending posts to several accounts
      // records none — so this reconciles by budget code in that case rather than by a GL it does
      // not have.
      const account = b.account?.id
        ? byId.get(b.account.id)
        : b.glAccount
          ? byCode.get(b.glAccount)
          : undefined;
      // A budget whose gl_account resolves to no account row still gets a row: its budget figures
      // are real and its ledger movement is zero, which is itself worth seeing.
      const key = account ? account.id : `budget:${b.node.code}`;
      keyOfBudget.set(b.id, key);
      if (!keyInfo.has(key)) {
        keyInfo.set(key, {
          key,
          accountId: account?.id ?? null,
          code: account?.code ?? b.node.code,
          name: account?.name ?? null,
          direction: account ? directionOf(account.accountType) : 1,
        });
      }
    }
  }

  /** The chosen year, or the one covering the COMPANY's today, or the most recent one. */
  private async resolveFiscalYear(
    em: EntityManager,
    companyId: string,
    /** The ACTIVE COMPANY's years — so a choice is refused by not being among them (invariant 1). */
    years: FiscalYear[],
    fiscalYearId?: string,
  ): Promise<FiscalYear> {
    if (fiscalYearId) {
      const chosen = years.find((y) => y.id === fiscalYearId);
      if (!chosen) throw new NotFoundException(`Fiscal year ${fiscalYearId} not found`);
      return chosen;
    }
    if (!years.length) {
      throw new NotFoundException('This company has no fiscal year to reconcile');
    }
    const company = await em.findOneOrFail(Company, { id: companyId }, FILTER_OFF);
    const today = localDateIn(new Date(), company.timezone);
    return years.find((y) => y.startDate <= today && today <= y.endDate) ?? years[0];
  }
}

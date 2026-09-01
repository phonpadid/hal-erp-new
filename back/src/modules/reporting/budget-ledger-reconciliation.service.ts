import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { AccountType, BudgetTxnType } from '../../common/enums';
import { Money } from '../../common/money/money';
import { localDateIn } from '../../common/time/company-clock';
import { Account } from '../accounting/accounting.entities';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { Document, DocumentLine } from '../document/document.entities';
import { apportion, type ApportionableLine } from '../gl/apportion';
import { chargedDocumentIdOf, SOURCE_MANUAL, VALUE_DP } from '../gl/gl-posting.service';
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
   * Consumption charged to THIS account's budgets that debited a DIFFERENT account, because the
   * lines charging them named one.
   *
   * A budget may post to several accounts since `debit-the-account-the-line-named`, so the account
   * a budget belongs to and the accounts its spending reaches are no longer the same thing. Without
   * this the report calls the gap unexplained, in a report whose whole claim is that it reaches
   * zero.
   */
  spentOnAnotherAccount: string;
  /**
   * …and the mirror: consumption charged to OTHER accounts' budgets that debited this one.
   *
   * Reported apart from its twin rather than netted, for the reason the crossings are: a budget
   * sending its spending out and an account receiving spending in are different facts, and an
   * account that does both would report nothing at all if they were added.
   */
  receivedFromAnotherAccount: string;
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
   *            + spentOnAnotherAccount − receivedFromAnotherAccount
   */
  unexplained: string;
}

/** How many crossing documents an account lists before the report reports a count instead. */
const CROSSINGS_SHOWN = 10;

/** One row's identity: which account it reads the ledger on, and how its movement is signed. */
interface KeyInfo {
  key: string;
  accountId: string | null;
  code: string;
  name: string | null;
  direction: 1 | -1;
  /**
   * Whether a budget of this year names this account.
   *
   * False for an account that only RECEIVED spending from another account's budget — it gets a row
   * so the movement is not invisible, but it is not a budgeted account, and the
   * vouchers-on-budgeted-accounts figure means what it says.
   */
  budgeted: boolean;
}

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

    const keyInfo = new Map<string, KeyInfo>();
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
          // `budget.account` is the fallback the apportionment lands on when a document's lines
          // name none — the same fallback the posting used, so it must be loaded, not a reference.
          { ...FILTER_OFF, populate: ['budget.account'] },
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
    /**
     * Per (account, document): where that document's IN-YEAR consumption on this key's budgets
     * actually landed, by account id.
     *
     * A budget may post to several accounts since `debit-the-account-the-line-named`, so `consumed`
     * on a row and the movement on that row's account are no longer the same money. This is the
     * bridge between them, and it is re-derived the way the posting derived it rather than guessed:
     * same `apportion`, same `budget_base_line_amount` basis, same fallback to the budget's own
     * account. Both sides read values stamped at submit and immutable after it, so they cannot
     * disagree.
     *
     * Accumulated only for NON-crossing rows. A crossing is explained by its own cause before the
     * per-document ones are reached, and splitting it here too would claim the same money twice.
     */
    const landedByDoc = new Map<string, Map<string, Map<string, string>>>();
    // One line read per charged document, not per ACTUAL row: a document charging six budgets has
    // six rows and one set of lines.
    const linesByDoc = new Map<string, DocumentLine[]>();
    for (const t of actuals) {
      const key = keyOfBudget.get(t.budget.id);
      const docId = t.document?.id;
      if (!key || !docId) continue;
      const m = consumedByDoc.get(key) ?? new Map<string, string>();
      m.set(docId, Money.add(m.get(docId) ?? '0', t.amount));
      consumedByDoc.set(key, m);

      if (!(t.txnDate < fy.startDate || t.txnDate > fy.endDate)) {
        const split = await this.landedAccountsOf(em, t, linesByDoc);
        const byDoc = landedByDoc.get(key) ?? new Map<string, Map<string, string>>();
        const onDoc = byDoc.get(docId) ?? new Map<string, string>();
        for (const [accountId, amount] of split) {
          onDoc.set(accountId, Money.add(onDoc.get(accountId) ?? '0', amount));
        }
        byDoc.set(docId, onDoc);
        landedByDoc.set(key, byDoc);
      }

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

    // An account that RECEIVED spending from another account's budget carries no budget of its own,
    // so `resolveAccounts` never saw it and the ledger read below would not even query it. Without
    // this the money leaves one row explained and arrives nowhere — invisible, which is worse than
    // unexplained: an unexplained figure at least asks to be investigated.
    await this.addAccountsThatReceived(em, companyId, landedByDoc, keyInfo);

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
      if (entry.sourceType === SOURCE_MANUAL && info.budgeted) {
        const v = voucherByAccount.get(entry.id) ?? new Map<string, string>();
        v.set(info.key, Money.add(v.get(info.key) ?? '0', m));
        voucherByAccount.set(entry.id, v);
      }
    }

    const chargedDocs = new Set<string>();
    for (const m of consumedByDoc.values()) for (const d of m.keys()) chargedDocs.add(d);
    const posted = await this.documentsWhosePostingArrived(em, companyId, chargedDocs, postedInFy);

    // ── Where each budget's consumption actually landed ───────────────────────────────────────
    //
    // Cross-key, so it cannot be folded into the per-row loop below: what one account SENT is what
    // another RECEIVED, and the receiving row has no budget of its own to discover it from.
    //
    // Documents with no posting at all are skipped. Their consumption is already claimed in full by
    // the posting-never-arrived cause, and naming where it WOULD have landed would explain the same
    // money twice — the exact fault this whole section exists to fix.
    /** Per key: what this key's budgets consumed on accounts other than this key's own. */
    const spentElsewhere = new Map<string, string>();
    /** Per ACCOUNT ID: what other keys' budgets consumed here. */
    const receivedHere = new Map<string, string>();
    for (const [key, byDoc] of landedByDoc) {
      const info = keyInfo.get(key);
      if (!info?.accountId) continue;
      for (const [docId, onDoc] of byDoc) {
        if (!posted.has(docId)) continue;
        for (const [accountId, amount] of onDoc) {
          if (accountId === info.accountId) continue;
          spentElsewhere.set(key, Money.add(spentElsewhere.get(key) ?? '0', amount));
          receivedHere.set(accountId, Money.add(receivedHere.get(accountId) ?? '0', amount));
        }
      }
    }

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
      const landedOnKey = landedByDoc.get(info.key);
      for (const [docId, totalOnAccount] of perDoc) {
        // Only what stayed inside the year is this loop's business; the rest is already explained.
        const consumedOnAccount = Money.subtract(totalOnAccount, crossedOnAccount.get(docId) ?? '0');
        if (Money.compare(consumedOnAccount, '0') <= 0) continue;
        if (!posted.has(docId)) {
          // The money went NOWHERE: budget charged, no journal entry at all.
          neverArrived = Money.add(neverArrived, consumedOnAccount);
          continue;
        }
        // Of what this document consumed, the part that belonged on THIS account — the rest is
        // already named by `spentElsewhere` above and must not be offered to the test below.
        //
        // That subtraction is the whole point. Capitalisation is inferred from consumption on an
        // account exceeding what the entries debited there, and while one budget meant one account
        // the only thing that could satisfy it was a diversion to the goods-received account. It is
        // not any more: spending sent to another EXPENSE account satisfies it identically, and the
        // report would answer "capitalised into stock" about money that never went near inventory.
        //
        // A key with no account row of its own has no ledger side to compare against and no landing
        // to read, so it keeps reading the whole consumption exactly as it did before.
        const own = info.accountId
          ? (landedOnKey?.get(docId)?.get(info.accountId) ?? '0')
          : consumedOnAccount;
        // The money went ELSEWHERE: the posting engine diverted the stock-tracked share to GRNI, so
        // what belonged on this account exceeds what this document's entries debited here. Taken as
        // that difference rather than re-derived from the stock lines — the engine already decided
        // the split, and a second derivation would be free to disagree with it (design D3).
        const debited = postedOnAccount.get(docId) ?? '0';
        if (Money.compare(own, debited) > 0) {
          capitalised = Money.add(capitalised, Money.subtract(own, debited));
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

      const sentOut = spentElsewhere.get(info.key) ?? '0';
      const takenIn = info.accountId ? (receivedHere.get(info.accountId) ?? '0') : '0';

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
        spentOnAnotherAccount: sentOut,
        receivedFromAnotherAccount: takenIn,
        consumedBeforeItsYear: before,
        consumedAfterItsYear: after,
        crossings: crossings.slice(0, CROSSINGS_SHOWN),
        crossingCount: crossings.length,
        // What remains AFTER the named causes, computed from the figures actually reported rather
        // than accumulated separately — so the decomposition the reader adds up is the one the
        // remainder was taken from. Any value but zero is a cause this report does not model.
        unexplained: Money.add(
          Money.add(
            Money.add(
              Money.add(Money.subtract(difference, causesTotal), capitalised),
              neverArrived,
            ),
            // `consumed` is subtracted to form `difference`, so consumption that should not have
            // counted for this year is added back — the sign follows every other cause.
            Money.add(before, after),
          ),
          // Same reasoning, both ways. `consumed` counts what this account's budgets spent
          // elsewhere, which overstates what `moved` here should be compared against, so it is
          // added back; `moved` counts what other accounts' budgets spent here, which overstates
          // the other side, so it is taken off.
          Money.subtract(sentOut, takenIn),
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
   * Where ONE `ACTUAL` row's money landed, by account id — the posting's own apportionment, re-read.
   *
   * `budget_txn` records what a budget was cut by and never which line cut it, so the split cannot
   * be looked up; it has to be derived. It is derived here exactly as `perAccountFromActuals`
   * derives it — `apportion` over the lines charging this budget, pro rata by
   * `budget_base_line_amount`, keyed by each line's stamped account and falling back to the
   * budget's own where a line carries none — because the two answers appearing in one report and
   * disagreeing would be worse than either being wrong alone.
   *
   * That this can be re-derived at all is what `debit-the-account-the-line-named` bought: the
   * account and the basis are both stamped at submit and immutable after it. Re-deriving from the
   * item's or the document type's `default_gl_account` would read configuration that may have
   * changed since, and would drift from the entry the ledger actually holds.
   *
   * Never throws. The posting fails on a line with neither account and the document then has no
   * entry at all, which the posting-never-arrived cause already reports; a read-only report has no
   * business raising where the thing it reports on merely did not happen.
   */
  private async landedAccountsOf(
    em: EntityManager,
    txn: BudgetTxn,
    linesByDoc: Map<string, DocumentLine[]>,
  ): Promise<Map<string, string>> {
    const docId = txn.document!.id;
    let lines = linesByDoc.get(docId);
    if (!lines) {
      lines = await em.find(
        DocumentLine,
        { document: docId },
        { ...FILTER_OFF, populate: ['account', 'budget.account'] },
      );
      linesByDoc.set(docId, lines);
    }

    const parts: ApportionableLine[] = [];
    for (const l of lines) {
      if (l.budget?.id !== txn.budget.id) continue;
      const basis = l.budgetBaseLineAmount ?? '0';
      if (Money.compare(basis, '0') <= 0) continue;
      const account = l.account ?? l.budget?.account;
      if (!account) continue;
      parts.push({ accountId: account.id, basis });
    }

    const split = apportion(txn.amount, parts, VALUE_DP);
    if (split.size) return split;

    // No line carried a basis — an imported spend, or a document written before lines did. The
    // whole amount posted to the budget's own account, which is the row this ACTUAL already sits
    // on, so the bridge is the identity and every figure below reads as it did before this change.
    const own = txn.budget.account;
    return own ? new Map([[own.id, txn.amount]]) : new Map();
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

  /**
   * Give a row to every account that RECEIVED budget spending without carrying a budget of its own.
   *
   * `resolveAccounts` builds the report's rows from budgets, which was the whole population while
   * one budget meant one account. A line may now name an account no budget points at — an item's
   * `default_gl_account`, a document type's — and that account would otherwise appear nowhere: not
   * as a row, and not even in the ledger query below, which is driven by the same map.
   *
   * The consequence of skipping this is worse than an unexplained figure. The sending row explains
   * itself, the receiving movement is never read, and the report balances by never asking — the
   * same failure as bounding the budget side by `txn_date`, arrived at from the other direction.
   *
   * Scoped to the active company (invariant 1), and marked `budgeted: false` so the
   * vouchers-on-budgeted-accounts figure keeps meaning accounts a budget actually names.
   */
  private async addAccountsThatReceived(
    em: EntityManager,
    companyId: string,
    landedByDoc: Map<string, Map<string, Map<string, string>>>,
    keyInfo: Map<string, KeyInfo>,
  ): Promise<void> {
    const missing = new Set<string>();
    for (const byDoc of landedByDoc.values()) {
      for (const onDoc of byDoc.values()) {
        for (const accountId of onDoc.keys()) {
          if (!keyInfo.has(accountId)) missing.add(accountId);
        }
      }
    }
    if (!missing.size) return;

    const accounts = await em.find(
      Account,
      { id: { $in: [...missing] }, company: companyId },
      FILTER_OFF,
    );
    for (const a of accounts) {
      if (keyInfo.has(a.id)) continue;
      keyInfo.set(a.id, {
        key: a.id,
        accountId: a.id,
        code: a.code,
        name: a.name,
        direction: directionOf(a.accountType),
        budgeted: false,
      });
    }
  }

  /** Resolve each budget to the account its ledger movement is read on, and remember the mapping. */
  private async resolveAccounts(
    em: EntityManager,
    companyId: string,
    budgets: Budget[],
    keyInfo: Map<string, KeyInfo>,
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
          budgeted: true,
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

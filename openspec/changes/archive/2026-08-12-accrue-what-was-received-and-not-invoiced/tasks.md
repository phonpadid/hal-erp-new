## 1. The role

- [x] 1.1 `back/src/common/enums/index.ts` and `erp_approval_system.dbml` — `ACCRUED_EXPENSE` in
      `account_role_type`, noted as the same shape as `GRNI` for the purchases `GRNI` does not
      cover: credited when a period closes, debited by the reversal the day after.
- [x] 1.2 `back/src/seed/seed-data.ts` — map it to its own liability account. Do **not** share
      `GRNI` (2150), `WHT_PAYABLE` (2100) or `ACCOUNTS_PAYABLE` (2000): two roles on one account
      makes both balances unreadable, which is the note already sitting beside the AP mapping.

## 2. The one helper, at last

- [x] 2.1 `back/src/modules/gl/gl-posting.service.ts` — export the ref-chain line-account walk
      (`accountByLineOf` plus the `ref_document_id` traversal) as one helper the new query can use.
      This is the **fourth** place needing "the budget account behind a chained line", and
      `raise-the-payable`'s design said the fourth should make it a helper (design D2).
- [x] 2.2 Do **not** rewrite the other three call sites onto it. `cutBudget` and `settlementActuals`
      work, their tests pass, and changing three working paths to make a point about duplication is
      how a small change becomes a risky one. Leave the note for whoever next touches them.

## 2b. When it was received — SCOPE GROWTH, found by test 5.1

- [x] 2b.1 `document_line.last_received_at` (nullable timestamptz) in the DBML, the entity, and one
      migration. `received_qty` is a running total with no time on it, so "received as at the 30th"
      was unanswerable — the first implementation used the order's `created_at` as a proxy and
      accrued nothing at all for any month already past, which is what the test caught (design D6).
- [x] 2b.2 `receiving.service.ts` stamps it whenever a receipt advances `received_qty`, for tracked
      and untracked lines alike.
- [x] 2b.3 Every existing row stays null. A receipt recorded before the column existed happened at a
      time nobody wrote down; the accrual treats null as "received at some unknown past time" and
      INCLUDES it, because excluding would understate silently.

## 3. What is received and not invoiced

- [x] 3.1 `back/src/modules/gl/received-not-invoiced.service.ts` (new) — for a company as at a date,
      return the outstanding value per expense account: PO lines whose `received_qty` exceeds what
      has been invoiced against them, valued at `budget_base_line_amount / qty` (design D1), and
      whose `last_received_at` is on or before that date or absent (section 2b).
- [x] 3.2 Invoiced quantity comes from the disbursement lines that reference the order at the same
      `line_no` — the link `MatchingService` already uses for three-way matching. Read it the same
      way rather than inventing a second notion of "invoiced".
- [x] 3.3 Exclude a line whose `item.is_stock_tracked` is true: its receipt already credited `GRNI`,
      and accruing again would recognise the same purchase twice. **Include** an item-less line — a
      free-text service line is exactly the case with no other coverage.
- [x] 3.4 Resolve the expense account through the helper from 2.1, not from the PO line's own budget:
      `PO` is not a budget-controlled type, so its lines carry none.
- [x] 3.5 Value in base currency at the locked rate (`budget_base_line_amount`), never `unit_price`
      — the latter is a document-currency figure and this is a base-currency ledger.

## 4. Closing posts the pair

- [x] 4.1 `accounting-period.service.ts` — after the readiness check and the ordering check, and
      before the status flips: compute the outstanding, and if it is non-empty post the accrual
      dated `period_end` (Dr each expense account, Cr `ACCRUED_EXPENSE`).
- [x] 4.2 Post its reversal dated `period_end + 1` **in the same operation**. Not deferred, not
      owed: a reversal that is a future intention is how an expense gets recognised twice
      (design D3).
- [x] 4.3 Key both to the period — `PERIOD_ACCRUAL` and `PERIOD_ACCRUAL_REVERSAL`, `source_id` the
      period's id — so a re-close is a no-op rather than a double-post, and document at the call
      site that this also means the figure is computed once and never recomputed (design D4).
- [x] 4.4 Nothing outstanding posts nothing: no zero-value voucher, no empty entry (design D5).
- [x] 4.5 An unmapped `ACCRUED_EXPENSE` fails the CLOSE, unlike an event-driven posting which is
      logged and queued. A close is synchronous and its caller can map the account and retry, so
      refusing is the better answer than closing a month with its accrual missing.

## 5. Tests

- [x] 5.1 A received, uninvoiced service line accrues: the entry is dated `period_end`, debits the
      order's expense account and credits `ACCRUED_EXPENSE`.
- [x] 5.2 The reversal exists, dated the day after, and exactly undoes it. Assert both entries, not
      just the first — the pair is the whole mechanism.
- [x] 5.3 A partly invoiced line accrues only the remainder (received 10, invoiced 4 → 6 accrued).
- [x] 5.4 A stock-tracked line contributes nothing. Without this the same purchase is recognised
      twice, once here and once through `GRNI`.
- [x] 5.5 An item-less line DOES accrue — the case with no other coverage, and the one an
      over-eager filter would drop.
- [x] 5.6 A fully invoiced period writes no accrual and no reversal at all.
- [x] 5.7 Re-closing after a reopen leaves exactly one accrual and one reversal.
- [x] 5.8 The accrual writes no `budget_txn`.
- [x] 5.9 An unmapped `ACCRUED_EXPENSE` rejects the close and leaves the period open.
- [x] 5.10 Existing suites stay green — 1379 backend tests today. Every period-close case that
      predates this must still pass, including the one asserting a company with no periods is
      unaffected.

      **Result:** `npx vitest run` — **1389 passed, 36 skipped, 0 failed** (133 files), up from 1379
      by the ten cases added here. `nest build` clean. The twelve existing period-close cases pass
      unedited apart from the constructor gaining its three new dependencies.

      **Two cases were added beyond the plan**, both from section 2b: a receipt after the period end
      is not accrued, and a receipt with no recorded date is. Without them the date filter — the
      whole reason this change grew a column — would have had no test at all: the original fixture
      left `last_received_at` null, which every line passes.

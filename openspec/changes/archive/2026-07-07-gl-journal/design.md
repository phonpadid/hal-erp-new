## Context

Today money is tracked only as single-sided budget commitments in `budget_txn`
(RESERVE/ACTUAL/RELEASE) — encumbrance accounting, not a general ledger. The chart of
accounts (`account`, per company, typed) now exists, and `payment-handoff` emits
`payment.settled` when an actual payment + FX is recorded, consumed by `PaymentHandoffListener`
— a dispatch seam that currently only logs. This slice adds a double-entry general ledger and
a posting engine that turns each settlement into a balanced journal entry against the chart of
accounts. It reuses the payment's already-computed base amounts and FX delta; it does not
change the budget ledger, the payment flow, or the FX computation.

## Goals / Non-Goals

**Goals:**
- Append-only `journal_entry` / `journal_line` with the hard invariant Σdebit = Σcredit per
  entry, company-scoped, base-currency, decimal strings.
- A posting engine that, on `payment.settled`, writes one balanced entry per settled
  document: Dr the budget's expense account(s) at the locked base, Cr a cash-clearing
  account at the actual base, and post the FX difference to a realized FX gain/loss account.
- Idempotent posting (one entry per source payment) so event retries never double-post.
- Config-driven system-account resolution via an `account_role` map (no hardcoded codes).
- Read-only journal query gated by `GL_VIEW`.

**Non-Goals:**
- No posting periods / period-close, no closing entries (a later slice).
- No AP/AR subledger — the credit side is a cash-clearing account, not a vendor open item.
- No VAT/WHT, no fixed assets, no financial statements (trial balance / P&L / balance sheet).
- No reversing-entry UI — corrections as reversing entries are supported by the data model
  (append-only) but exposing them is future work.
- No accrual at goods-receipt (GR/IR) — posting happens at payment in this slice.

## Decisions

**1. Post on `payment.settled`, post-commit, in the ledger's own transaction.**
The engine subscribes to the existing `payment.settled` event (fired after the payment
transaction commits). It runs in its **own `em.transactional()`** that writes the
`journal_entry` header and all its `journal_line` rows atomically (all-or-nothing), and reads
the document, its budget line accounts, and the payment's base amounts to build the entry.
_Alternative:_ post inside the payment transaction — rejected because a GL failure must never
roll back an already-valid payment (invariant: the payment is authoritative; accounting is
downstream). Because it is post-commit, a failure is logged and retryable.

**Sequence (writes `journal_line`, never `budget_txn`):**
1. `payment.settled` fires with the settled document id.
2. Engine opens `em.transactional()`; re-reads the payment (base_locked, base_actual,
   fx_delta, fx_kind) and the document's budget lines → distinct expense accounts + base
   amounts.
3. If a journal entry with this source key already exists → no-op (idempotent), commit
   nothing.
4. Build lines: Dr each expense account (Σ base_locked per account); Cr cash-clearing
   (base_actual); one FX line (Dr FX_LOSS or Cr FX_GAIN) for `fx_delta`.
5. Assert Σdebit = Σcredit; persist header + lines; commit.
This flow does **not** write `budget_txn` or `quota_usage` (invariant 6 — FX and the payment
posting stay out of the budget). No pessimistic lock is needed: there is no shared mutable row
to contend on; concurrency safety comes from the idempotency uniqueness (below), and the
single `em.transactional()` keeps the header+lines atomic.

**2. Balanced-entry invariant enforced in code + shape.** `journal_line` carries `debit` and
`credit` decimal(15,2) columns (exactly one non-zero per line). The service sums both sides
with the `Money` helper and throws before persisting if they differ by any minor unit. The
entry is meaningless unless balanced, so this is a guard, not a warning.

**3. Idempotency via a source key unique per company.** `journal_entry` has
`(source_type, source_id)` (e.g. `('PAYMENT', <paymentId>)`) with a unique constraint per
company. The engine checks-or-inserts on that key; a retried event finds the row and no-ops.
This is the concurrency backstop in lieu of a lock.

**4. Append-only, like `budget_txn`.** `journal_entry` and `journal_line` are added to the
`LedgerGuardSubscriber` append-only set; UPDATE/DELETE throw. Corrections are new reversing
entries. Balances/reports derive from summation, never mutation.

**5. System accounts resolved by role, not code (invariant 7).** A new `account_role` table
maps `(company, role)` → `account`, with roles `CASH_CLEARING`, `FX_GAIN`, `FX_LOSS`. The
engine resolves each via this map (reusing the chart-of-accounts). Seed installs default
mappings per company. A missing/inactive mapping makes the posting a **logged failure**
(retryable once configured), never a crash of the payment flow.
_Alternative:_ a `system_role` column on `account` — rejected; a separate map lets one account
serve multiple roles and keeps `account` a pure master.

**6. Expense side from the document's budget lines.** The debit accounts are the `account`s
of the budgets the document charged (via `budget.account_id`, resolving the `gl_account`
code). Multiple lines on the same account are summed into one debit line. Amounts use
`base_locked` (the locked basis the budget was cut at); the FX delta is the only difference to
`base_actual`, matching invariant 6.

## Risks / Trade-offs

- **[A posting fails after the payment committed]** → It's post-commit and isolated in its own
  transaction; the payment stays valid. Failure is logged; the idempotency key makes a manual
  or automatic retry safe (no double-post).
- **[Missing `account_role` mapping for a company]** → Posting is a logged no-op/failure for
  that company until the mapping is seeded/configured; the payment is unaffected. Seed installs
  defaults so the demo path always posts.
- **[Rounding leaves Σdr ≠ Σcr by a minor unit]** → All math uses the `Money` decimal helper in
  the company base currency; `base_actual = base_locked + fx_delta` by construction, so the FX
  line closes the entry exactly. The balance assert catches any drift and fails the posting
  rather than writing an unbalanced entry.
- **[Document charges budgets with no resolvable expense account]** → Since chart-of-accounts
  now validates `budget.gl_account` at creation and stamps `account_id`, settled documents have
  resolvable accounts; a null `account_id` (un-backfilled legacy budget) makes the posting a
  logged failure to be resolved by backfilling, not a silent wrong entry.

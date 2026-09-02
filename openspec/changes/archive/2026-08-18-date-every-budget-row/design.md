# Design

## D1. There is exactly one place to stamp it

`budget_txn` has a single writer:

```ts
// budget-ledger.service.ts:48
private insertTxn(tem, budgetId, documentId, txnType, amount, remark?): void
```

Everything that touches the budget ledger — `reserve`, `settle`, `releaseAll`, `executeTransfer`,
and the post-action that writes an `ADJUST_INCREASE` / `ADJUST_DECREASE` — goes through it. This is
the same shape `gl-journal` gives entries (*Every Entry Is Written Through One Balanced
Constructor*), and it means the date is enforced at one point rather than remembered at six.

`insertTxn` gains a required `txnDate` parameter. Required, not defaulted: a default would be
`today`, which is right for four of the five callers and silently wrong for the fifth, and being
wrong about a date is the failure mode this change exists to remove.

## D2. The day is the company's, resolved once, from the event

`journal_entry.entry_date` is the posting company's own calendar day, from `company.timezone`, via
`localDateIn` — because a date decides which side of a boundary a fact falls on. A budget row that
used a different rule would put the two ledgers on different calendars, and
`name-the-year-boundary-in-the-reconciliation` compares them.

So `txn_date` is `localDateIn(instant, company.timezone)`, and the *instant* each caller supplies is
the event's own, never `new Date()` at insert time:

| row | instant | why not "now" |
| --- | --- | --- |
| `RESERVE` | `document.submitted_at` | submit and its holds are one transaction; the day is the submit's |
| `ACTUAL` | the post-action's run instant | the day the reservation became spending |
| `RELEASE` (reject / cancel / return) | the acting instant | the day somebody released it |
| `RELEASE` (unused difference at settlement) | the same instant as its `ACTUAL` | one event, one day: they must not split across a boundary |
| `TRANSFER_OUT` / `TRANSFER_IN` | `budget_movement.effective_date` | the movement already states when it takes effect |
| `ADJUST_INCREASE` / `ADJUST_DECREASE` | `budget_movement.effective_date` | same |

The transfer pair is the interesting one. `budget_movement.effective_date` exists and is nullable;
when it is absent the pair falls back to the approval day, which is the day the movement actually
took effect. The pair SHALL share one date whichever path supplies it — a `TRANSFER_OUT` dated
differently from its `TRANSFER_IN` would make the two halves of one movement land in different
months, and the invariant that they commit atomically would stop meaning anything at the reporting
layer.

## D3. `created_at` stays, and stops being asked to do two jobs

`created_at` is when the row was inserted. `txn_date` is when the event happened. They differ
whenever a backdated movement is approved, whenever a settlement is posted the morning after, and
across every timezone boundary.

Keeping both is not redundancy: one answers "when did the system learn this" and the other "when did
this happen", and audit needs both. What changes is that `created_at` stops being the only thing
available and therefore stops being misused as the second.

`created_at` also stays nullable, because making it not-null is a different change with no user
behind it.

## D4. As-of reads: a bound, not a new report

`BudgetBalanceService` already computes every figure by folding `budget_txn` rows. Bounding that fold
by `txn_date <= asOf` is one `where` clause, and it turns four existing reads into as-of reads:

```
balanceOf(budgetId, asOf?)          the derived balance as it stood
breakdown(budgetId, asOf?)          the same, decomposed by txn type
outstandingReserved(docId, asOf?)   what was still held
ledger(budgetId, asOf?)             the rows themselves
```

`asOf` defaults to today, so every existing caller keeps its current meaning and no read changes
shape. The bound is `<=` on a date, so "as of 30 June" includes everything that happened on 30 June
— the reading a person means when they say it.

**The control-point check does NOT take an `asOf`.** Availability is checked against the balance
*now*, because a reservation is made now; letting it be evaluated as of a past date would be a way
to spend money that has since been committed. The parameter exists on the reads, not on the gate.

## D5. Nothing about the balance formula moves

```
balance = amount_total + ADJUST_INCREASE − ADJUST_DECREASE
                       + TRANSFER_IN − TRANSFER_OUT
                       − RESERVE + RELEASE
```

Unchanged, `ACTUAL` still not subtracted (invariant 3). A date is a coordinate on a row, not a term
in the equation. The only thing that changes is that the fold can be stopped at a date.

## D6. Migration

`txn_date` is added `not null` with no backfill: nothing has launched, and a dev database that
happens to hold rows can be dropped and re-seeded like any other. Inventing a backfill from
`created_at` would write dates nobody recorded and give them the authority of stored data — the
exact failure this change is about.

An index on `(budget_id, txn_date)` follows the read it exists for: every as-of fold is "this
budget's rows up to a day".

## D7. What this leaves for later

| left out | why |
| --- | --- |
| budget periods (monthly phasing) | a dated ledger answers "consumed in March"; "over plan for March" needs a plan for March, which is a model change with its own argument |
| burn-rate / elapsed-time comparison | a report question, answerable now that consumption has dates, and it belongs to whoever asks for it |
| making `created_at` not-null | no user behind it; unrelated to this |
| dating `quota_usage` the same way | the same omission probably exists there; it deserves its own look rather than a drive-by |

## Risks / trade-offs

- **A required parameter on `insertTxn` means every caller is a compile error until it supplies a
  date.** → That is the point, and there are five of them. A defaulted parameter would let a caller
  be silently wrong, which is the class of bug being removed.
- **The instant a caller passes may itself be wrong** (e.g. a post-action using `new Date()` when the
  approval happened seconds earlier). → The date is a calendar day, and the two differ only across
  a midnight boundary in the company's own zone. Where an exact instant exists on the record
  (`submitted_at`, `effective_date`) the caller passes it; where the event IS the call, "now" is the
  honest answer.
- **As-of reads invite as-of control checks.** → D4 says no, and the reason is written where the
  parameter is not offered.
- **This change writes no new `budget_txn` rows and changes no amount.** It adds a column, threads a
  parameter, and adds an optional bound to four reads. No `PESSIMISTIC_WRITE` changes: the
  control-point lock rule in `BudgetLedgerService` is untouched.

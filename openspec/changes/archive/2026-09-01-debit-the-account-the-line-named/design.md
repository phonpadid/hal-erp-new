## Context

Two answers to "which account does this spending hit", written at different times, and only one is
ever read.

`document_line.gl_account` is stamped when the draft is written
(`DocumentService.resolveLineGlAndBudget`): the item's `item_company.default_gl_account` when the
line has an item — a hard branch, refused rather than fallen through when the type requires a budget
— else `document_type.default_gl_account`, else `budget.gl_account`, else nothing.

`budget.account_id` is what the ledger debits. `grep glAccount` over `gl-posting.service.ts` returns
nothing: the posting reads `DocumentLine` twice and populates `budget.account` both times. The line's
own stamp is never opened.

`accountByLineOf` states the reason, and it is a good one:

> The ACCOUNT comes from that line's budget, deliberately not from the item's `default_gl_account`.
> The item route lands on the same account today — that GL is how the budget was resolved in the
> first place — but re-deriving it means an item whose default GL is edited after its predecessor
> was approved would clear a different account than the budget was cut on, silently, with the entry
> still balancing.

That objection is to **re-deriving mutable configuration at payment time**, and it stands. It is not
an objection to reading a value fixed when the document was submitted, which is what
`budget.account_id` effectively is today and what this change makes the line carry.

## Goals / Non-Goals

**Goals:**

- One budget may post to several accounts, because the plan really is shaped that way.
- The account a person configures where the product asks for it — the item, the document type —
  reaches the ledger.
- No settled document's entry changes, and no posting that works today stops working.
- The submit refusal keeps its property of being raised before anything is reserved.

**Non-Goals:**

- Backfilling `document_line.account_id` for existing documents. A null means "post the old way",
  which is the behaviour those documents already have.
- Changing what `budget_txn` holds, or when RESERVE / ACTUAL / RELEASE are written.
- Letting a line name an account directly on the form. The account stays derived from
  configuration; this change only fixes which derivation the ledger honours.
- Removing `budget.gl_account` or `budget.account_id`. Both stay, as the last step of the chain and
  as the fallback for documents that predate the stamp.

## Decisions

### D1 — Stamp a resolved FK at submit, never a code at payment

`document_line.account_id`, nullable, FK to `account`. Written in `DocumentSubmitService.submit`
beside `budgetBaseLineAmount` — the same place, in the same pass, for the same reason: both are the
basis the settlement will be computed on, and both must be fixed at the moment the document leaves
the requester's hands.

Resolved through `AccountService.resolvePostable`, so an inactive or non-postable code is a refusal
at submit rather than a stranded posting later. Stamping the **id**, not the code, is what answers
`accountByLineOf`'s objection: a later edit to the item's default GL, or to the budget's, moves
nothing that has already been submitted.

The string `document_line.gl_account` stays exactly as it is — a display value, resolved at draft
time, free to be empty. It is not what the posting reads; the FK is.

**Sequence note.** This writes no `budget_txn` and no `quota_usage`. The stamp and the refusal both
sit in the submit pass that already computes `budgetBaseLineAmount`, before `reserveLines` is built
and before the write transaction opens, so a refused submit leaves the document `DRAFT` with nothing
reserved. No lock: the values read are configuration, and a concurrent edit to them is a race the
stamp exists to end.

### D2 — Refuse the line, not the budget

`say-where-the-money-lands-before-it-moves` refuses a submit when a charged budget has no
`account_id`. That test is replaced by: every line with a positive amount must resolve an account
through the chain. A budget with no account passes when its lines get an account from the item or
the type, and fails only when nothing anywhere names one — which is the real condition.

The message names the line and the three places an account can come from, because which one to fill
in is the reader's decision and depends on what the line is.

### D3 — Apportion each budget's ACTUAL across the lines charging it

The expense side is keyed by account and must total exactly what the budget was cut by. `budget_txn`
has no line reference — an ACTUAL row is per `(document, budget)` — and `settle` may write an ACTUAL
smaller than the reservation, releasing the difference. So the split is pro rata:

```
for each ACTUAL row (budget B, amount A):
    lines charging B, by budget_base_line_amount   → L1 … Ln, total T
    share(Li) = round(A × Li / T)
    the largest line absorbs A − Σ share            ← so Σ share = A, exactly
    accumulate share(Li) onto account_of(Li)
```

`budget_base_line_amount` is the basis the budget was reserved and settled on, already stamped at
submit, so the weights and the amount being split come from the same number. Rounding to the
currency's scale leaves at most one minor unit, given to the largest line rather than the last so the
result does not depend on line order.

When `T` is zero — no line carries a budget basis — the whole `A` goes to the budget's own account,
which is today's behaviour and the case a spend-history import produces.

### D4 — A line with no stamped account falls back to its budget's

Every document submitted before this change has `account_id` null on every line. Those documents
must post the way they always did, and the fallback is not a migration step to be removed later:
`spend-import` writes lines directly, and a chain settled through an ancestor reads that ancestor's
lines, which may be older than this change.

So the account for a line is `line.account ?? line.budget.account`, and the refusal at submit is
what keeps the second half from being reached by anything new. Only when both are absent does the
posting fail — with the message and the `blocked_by_budget_id` cause that
`say-where-the-money-lands-before-it-moves` already added.

### D5 — The budget screens stop overstating it

`budgets.list.noAccount` and `budgets.form.glAccountHint` currently say a budget naming no account
cannot be charged. After this that is false: it can, when its lines resolve an account elsewhere.
The mark becomes a statement about the fallback — this budget supplies no account of its own, so a
line that names none through its item or type has nothing to fall back to — or it goes. It goes:
`namesNoAccount` on the list read was added to warn about a refusal that will no longer happen, and
a mark that no longer predicts anything is worse than no mark.

## Risks / Trade-offs

- **The expense side moves.** Two documents charging one budget through items with different GLs
  used to debit one account and will now debit two. That is the intent, and it changes the shape of
  the trial balance from the first settlement after deployment. Nothing already posted is touched —
  `journal_entry` is append-only and the idempotency key is unchanged — but the comparison between
  last month and this one is no longer like for like, and the accountant must be told.
- **A wrong item GL now reaches the ledger.** The blast radius of a mis-configured
  `item_company.default_gl_account` grows from "the line displays the wrong code" to "the entry
  debits the wrong account". Bounded by resolution at submit — the value is checked postable, and
  fixed from that moment — and this is the ordinary cost of honouring configuration the product
  already asks for.
- **Pro-rata is an estimate when ACTUAL is partial.** Settling less than was reserved splits the
  shortfall across lines in proportion, which is right in aggregate and arbitrary per line. Nothing
  in the data says which line was under-spent; the alternative is to invent a rule that says so.
- **Two accounts for one budget make the budget-to-ledger reconciliation a many-to-many.** It
  reconciles on totals per document, which still hold. Worth re-reading before shipping.
- **The refusal gets harder to satisfy for item-less lines.** A type with no `default_gl_account`
  whose budget names none now refuses at submit, same as before — the fix is one field on the
  document type instead of one on every budget, which is fewer places, but it is still a field
  somebody has to fill in before anyone can submit.

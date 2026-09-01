## Why

A document already decides which expense account each of its lines belongs to. `document_line.gl_account`
is resolved when the draft is written, from the item's per-company GL, else the document type's
`default_gl_account`, else the budget's own code. The ledger ignores all of it: `Posting on Payment
Settlement` debits `budget.account_id` and nothing else.

So the account a budget officer configures where the product asks for it — on the item, on the
document type — has no effect on the ledger, and the only account that matters is one the same
screens describe as optional. Setting `default_gl_account` on `RECADMIN` today stamps every new
line correctly and still posts nothing, because the budget behind those lines names no account.

It also forces a false shape onto the plan. One budget can debit exactly one account, so
`1.3 ຄ່າງວດລົດ` — loan principal and interest, two accounts by any accounting standard — has to
pick one and be wrong, or be split into two budgets the department does not think of as two.
`say-where-the-money-lands-before-it-moves` made that constraint loud rather than silent, which was
the right first move and is not the end of it: it refuses the submit, so the officer's only way
forward is to misstate the plan.

## What Changes

- Each money-bearing line carries the account its spending posts to, **resolved once at submit and
  stamped as a foreign key** (`document_line.account_id`) — not re-derived at payment. The
  resolution order is the one the line stamp already uses: the item's per-company GL, else the
  document type's default, else the charged budget's own account.
- The settlement and accrual entries debit the **line's** account, apportioning each budget's
  `ACTUAL` across the lines charging it pro rata by `budget_base_line_amount`. One budget may now
  post to several accounts; several budgets may still share one.
- **BREAKING (configuration):** a budget no longer needs to name a GL account. Submit stops asking
  whether the budget names one and asks instead whether every money-bearing line resolves one —
  which the budget can still answer, and now the item and the document type can too.
- A document submitted before this change keeps posting exactly as it does today: with no stamped
  account, the entry falls back to `budget.account_id`. Nothing is backfilled and no settled
  document's entry changes.
- The budget screens stop saying a budget without an account cannot be charged, because it can.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `document-engine`: submit SHALL stamp each money-bearing line's resolved expense account, and
  SHALL refuse a line that resolves none — replacing the per-budget refusal that
  `say-where-the-money-lands-before-it-moves` introduced.
- `gl-journal`: the expense side of a settlement and of an approval accrual SHALL be taken from the
  line's stamped account, apportioning each budget's `ACTUAL` across its lines, and SHALL fall back
  to `budget.account_id` for a line that carries none.
- `web-budgets`: the GL account is optional again, in fact and not only on save; the list mark and
  the form hint SHALL stop claiming a budget without one cannot be charged.
- `web-documents`: the submit refusal SHALL name the line that resolves no account and the three
  places an account can come from, rather than naming the budget alone.
- `reporting`: the budget-to-ledger reconciliation SHALL name the share of a budget's `ACTUAL` that
  debited an account other than the budget's own, and SHALL subtract it before inferring
  capitalisation into stock — the inference this change would otherwise turn into a false statement
  about inventory.

## Why `reporting` is in this change

It was not in the original proposal. Task 8.2 asked for the budget-to-ledger reconciliation to be
re-read against a budget now posting to two accounts rather than assumed to still hold, and it does
not hold: a budget on `5200` whose lines send 600 to `5210` leaves 600 unexplained on `5210` and
reports 600 on `5200` as capitalised into stock, money that went to an expense account and never
near inventory. The suite's own assertion that every row reaches zero goes red on the fixture.

It is folded in here rather than split out because this change is what breaks it. A separate change
would have to be archived first while making no sense on its own, and this one could not archive
until it was — a knot with no end to pull. The capability whose spec a change invalidates belongs to
that change.

## What moves the day this ships

**The expense side of the ledger changes shape, and the accountant has to be told before it does.**

Today one budget debits one account, so a budget's spending and an account's movement are the same
number read two ways. After this they are not. From the **first settlement after deployment**, a
budget's spending may debit several accounts — whichever ones its lines resolved through their items
and document types — and one account may receive spending from several budgets.

Nothing already posted moves. `journal_entry` is append-only, the idempotency key is unchanged, and
a document submitted before this change carries no stamped account and still posts to
`budget.account_id` exactly as it did. The change is entirely forward-looking, which is precisely
what makes it easy to miss: the books do not break, they quietly start answering a different
question.

The consequence to say out loud:

- **Month-on-month comparison is no longer like for like.** A month before deployment and a month
  after are not two samples of the same measurement. Any trend line, variance report or commentary
  that crosses the deployment date is comparing one-account-per-budget against
  several-accounts-per-budget, and the step it shows is this change, not the business.
- **A budget's total is still exact.** Every entry still debits in total what the budget was cut by;
  the apportionment splits that total, it does not alter it. What changed is where the total lands,
  not what it is.
- **`1.3 ຄ່າງວດລົດ` and its kind will visibly split.** A budget that was forced to name one account
  for spending that belongs in two will, from its next settlement, post to both. That is the change
  working, and it will look like a discontinuity in the trial balance.

Whoever explains the financial statements should be told the deployment date and given this
paragraph, before the first month-end that crosses it.

## Impact

**Backend**
- `back/src/modules/document/document.entities.ts` — `DocumentLine.account`.
- `back/src/modules/document/document-submit.service.ts` — stamp the account beside
  `budgetBaseLineAmount`; replace the per-budget gate with the per-line one.
- `back/src/modules/gl/gl-posting.service.ts` — `accountByLineOf`, `stockPortionByAccount`, the
  settlement expense side (`:576`) and the accrual expense side (`:719`).
- `back/src/modules/budget/budget.service.ts` — `namesNoAccount` on the list read.
- `back/src/modules/reporting/budget-ledger-reconciliation.service.ts` — the other-account cause and
  the capitalisation inference it has to run ahead of.

**Frontend**
- `front-end/src/views/budgets/BudgetListView.vue` and `BudgetFormView.vue` with their i18n.
- `front-end/src/views/documents/*` — the refusal wording.

**Data**
- One additive migration: nullable `document_line.account_id` with its FK and index. No backfill —
  a null is exactly the "post the old way" signal the fallback reads.

**Invariants** — none relaxed. No `budget_txn` is written, read differently, or reordered: the
apportionment is a read of amounts the ledger already holds, and every entry still debits in total
what the budget was cut by. Reserve → actual → release is untouched, company scope and permission
codes unchanged, and `journal_entry` stays append-only and balanced.

**Depends on** `say-where-the-money-lands-before-it-moves` being archived first: the requirements
this change modifies were added there and are not yet in `openspec/specs/`.

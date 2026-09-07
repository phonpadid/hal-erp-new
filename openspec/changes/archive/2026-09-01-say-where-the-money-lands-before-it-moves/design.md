## Context

Two rules about the same column disagree.

`budget.gl_account` is optional by construction: `CreateBudgetDto.glAccount` is optional,
`BudgetService.draftFor` resolves it to `budget.account_id` only *"when one is given"*, and the
entity comment says a budget spanning several accounts records none. The budget form repeats this to
the user — `budgets.form.glAccountHint`: *"Optional hint… leave it empty when spending posts to
several accounts."*

`gl-journal`'s `Posting on Payment Settlement` requires it: the expense side is debited *"via
`budget.account_id`"*. `GlPostingService` at `gl-posting.service.ts:518` (and `:661` for the accrual
path) throws when it is absent, with a comment calling it *"a legacy budget without a resolved
account — fail the posting (retry after backfill)"*. That assumption — that null means unmigrated
data, not a supported state — is what makes the two rules collide.

The collision is invisible until the money is gone. Order of events today:

```
submit          → RESERVE written                      (budget account never consulted)
final approve   → ACTUAL written, reserve settled      (budget account never consulted)
record payment  → payment row + slip stored            (budget account never consulted)
payment.settled → GL posting throws                    ← first and only time it is consulted
  ×5 sweeps     → gl_posting_attempt = FAILED, parked forever
```

The reader of that failure sees `Budget 8ad37658-… has no account_id; cannot post document
dd224a4d-…`. Neither id is a code they can search for. The two people who could act cannot: naming
the account is `BUDGET_MANAGE`, re-queueing is `GL_POST_RETRY`, and the accounting role in the live
company holds neither.

In `hal_erp` all 7 budgets have `gl_account = ''` and `account_id = NULL`, against a chart of 4,067
accounts. Six documents have settled or are settling; every one of their postings will die this way.

## Goals / Non-Goals

**Goals:**

- Refuse a document that cannot reach the ledger at the one moment refusing is free — before any
  `budget_txn` exists.
- Make the refusal name the budget by code and say where the account is set.
- Give the already-stranded postings a way back, driven by fixing the cause rather than by a
  separate permission.
- Stop the budget form from promising something the ledger will not honour.

**Non-Goals:**

- Changing where the posting takes its expense account from. It stays `budget.account_id`. Widening
  it to `document_line.gl_account` (item → type default → budget) would let a budget legitimately
  span several accounts and would change what a settlement entry debits — a separate change with its
  own scenarios.
- Backfilling the live company's budgets. That is configuration, done through the budget form.
- Touching `GL_POST_RETRY`, `GL_JV_APPROVE`, or any role's grants. Who holds which code is data.
- Any change to reserve → actual → release, or to any ledger amount.

## Decisions

### D1 — Refuse at submit, in the enablement guard that already re-checks the budget

`DocumentSubmitService.submit` step 4 already re-validates each line's budget and refuses an
inactive one:

```ts
if (l.budget && l.budget.status !== 'ACTIVE') {
  throw new BadRequestException(
    `Line ${l.lineNo} charges an inactive budget (GL ${l.glAccount ?? '—'}); …`,
  );
}
```

The GL-account check goes in the same loop, with the same shape. It is the right place for three
reasons: it is *after* the draft may be incomplete and *before* `reserveLines` is built, so a refusal
leaves the document DRAFT with nothing reserved; it is the established place for "the configuration
moved under the draft's feet"; and it re-reads the budget rather than trusting anything stamped at
draft time.

The test is `!l.budget.account` — the FK the posting reads, not `glAccount`. `account` is a
`ManyToOne` reference, so its id is available on the already-populated `budget` without another
query. Testing `glAccount` instead would pass a budget whose code failed to resolve, which is exactly
the state the posting dies on.

The message names the budget's **node code and name** (`1.101 — ອຸປະກອນເຄື່ອງໃຊ້ຫ້ອງການ`), not its
uuid, and says the account is set on the budget.

**Sequence note.** This flow writes no `budget_txn` and no `quota_usage`. The check runs in the read
fork (`read = this.em.fork()`), outside the `em.transactional` that later writes the holds, and
strictly before `reserveLines` is constructed. No lock is taken and none is needed: the value read is
configuration, and a budget edited concurrently to drop its account is still caught by the posting's
own guard, which stays in place as defence in depth.

### D2 — Record *why* a posting is stranded, so fixing the cause can un-strand it

`gl_posting_attempt` records `status`, `attempts` and `last_error` — prose. To re-queue exactly the
postings a particular budget blocked, the cause must be structured, not parsed back out of a message
we wrote.

Add one nullable column:

```
alter table "gl_posting_attempt" add column "blocked_by_budget_id" uuid null;
alter table "gl_posting_attempt" add constraint "gl_posting_attempt_blocked_by_budget_id_foreign"
  foreign key ("blocked_by_budget_id") references "budget" ("id") on update cascade on delete set null;
create index "gl_posting_attempt_blocked_by_budget_id_index"
  on "gl_posting_attempt" ("blocked_by_budget_id");
```

Set when a posting fails for a missing budget account; **cleared on every other outcome** so it can
never describe a stale cause. It is an attribute of the last attempt, not a ledger fact —
`gl_posting_attempt` is already a mutable bookkeeping row (the sweeper flips its status and counter),
so this breaks no append-only rule. `budget_txn` and `approval_log` are untouched.

This also lets the undelivered read name the budget by joining, rather than by re-deriving it from
the message.

### D3 — Naming a budget's account re-queues what it blocked

When `BudgetService.update` moves `account` from unset to set, the attempts blocked by that budget
reset to `PENDING` with `attempts = 0` — the same reset `JournalService.requeue` performs, reached
by fixing the cause instead of by holding `GL_POST_RETRY`.

This is deliberate: the person who can name the account is the person who should unblock the
postings that wanted it, and requiring a second permission and a second screen is what left the live
company's postings parked. `requeue` stays exactly as it is for every other cause.

Only unset → set triggers it. Changing one account to another does not: those postings were not
blocked, and re-posting a settled entry is refused by the entry's unique key anyway.

**Transaction boundary.** The reset shares the budget update's unit of work — one `em.flush()`, so a
failed budget update cannot leave postings re-queued for an account that was never saved. No
pessimistic lock: the reset is idempotent (`FAILED → PENDING` twice is `PENDING`), and the sweeper
re-checks `attempts < MAX_ATTEMPTS` under its own guarded update before acting.

### D4 — The message names codes, and says the one thing the reader can do

Both throws in `GlPostingService` (`:518` settlement, `:661` accrual) change from

> `Budget 8ad37658-9d63-4688-b923-06f71d759d57 has no account_id; cannot post document dd224a4d-…`

to a message carrying the budget's node code and the document's `doc_no`, and naming the budget form
as where the account is set. The resolution rule does not change — only what the failure says.

### D5 — The form stops calling it free

`budgets.form.glAccountHint` currently ends *"leave it empty when spending posts to several
accounts"*, which is advice that strands payments. It becomes a statement of consequence: a budget
with no GL account cannot be charged by a document. The multi-account case is real but is not served
by leaving this empty today — it is what the non-goal above defers.

## Risks / Trade-offs

- **Submitting gets stricter.** Any budget a document charges must now name an account. In `hal_erp`
  that is all 7 budgets, so until they are configured **every** budget-controlled submit is refused.
  That is the point — a loud refusal before the money moves is better than a silent one after — but
  it must be said plainly when this ships, because the first symptom is "nobody can submit anything".
- **The multi-account budget has no answer yet.** A budget like *vehicle instalments* (principal +
  interest) must pick one account or be split into two budgets. D5 tells the truth about today's
  behaviour rather than papering over it; the real fix is the deferred line-account change.
- **Auto-requeue could mass-retry.** Naming an account on a budget with many stranded postings
  re-queues them all at once. Bounded by the sweeper's own batch limit and `MAX_ATTEMPTS`, and each
  posting is idempotent on `(company, source_type, source_id)`, so the worst case is wasted work, not
  double entries.
- **`blocked_by_budget_id` can go stale if a later failure has a different cause.** Mitigated by
  clearing it on every outcome that is not this cause, which is cheaper to keep right than a
  reconciliation.
- **Documents already `COMPLETED` are not helped by the submit gate.** They are helped by D2–D4: name
  the account and their postings re-queue. Documents already `SKIPPED` (no ACTUAL rows) stay skipped
  — that is a settled answer, not a stall.

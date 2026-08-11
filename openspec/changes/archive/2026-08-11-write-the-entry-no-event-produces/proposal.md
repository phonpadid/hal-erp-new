## Why

Three changes in a row have stopped at the same wall and named it.

- `clear-grni-when-the-chain-pays-for-stock`: *"GRNI balances accumulated before this ships stay
  wrong until someone clears them deliberately, which needs a manual journal entry this system does
  not have yet."*
- `raise-the-payable-at-approval-not-at-payment`: documents approved beforehand keep their old
  posting, and nothing can restate them.
- `close-a-month-once-it-is-drained`: *"accrued-expense and FX-revaluation journals at close … both
  need a way to write a journal that no event produced — which this system does not have."*

`gl-journal` states the rule plainly: *"There is no create/update/delete endpoint for journal
entries — they are produced only by the posting engine."* That was right when the engine was the
only thing with an opinion about the ledger. It is now the reason a set of ordinary bookkeeping acts
are impossible:

```
depreciation                     no event produces it
accrued expense at period close  no event produces it
prepaid amortisation             no event produces it
payroll                          no event produces it
opening balances                 no event produces it — so the system cannot go live from
                                 an existing set of books at all
correcting a wrong posting       append-only means reversing, and nothing can write a reversal
```

The last two matter most. A system that cannot take opening balances can only be adopted by a
company with no history, and a ledger that can record a mistake but not correct it is worse than one
that can do neither — the error stays, visible and permanent, with no way to state the truth beside
it.

Everything needed already exists. `journal_entry` carries an `entry_date`, a `memo`, a `created_by`
and its lines; `createEntry` asserts the balance, resolves the company day and refuses a closed
period; `AccountService.resolvePostable` rejects an account that is missing, inactive,
non-postable, or another company's. What is missing is a door.

## What Changes

- **A manual journal voucher can be posted**: a date, a memo, and two or more lines, each naming a
  GL account and a debit or a credit. It goes through `createEntry` like every other entry, so it is
  balanced, dated in the company's day, refused in a closed period, company-scoped and append-only
  by construction. Gated by a new `GL_JV_POST`.
- **No new table.** The entry *is* the voucher — it already has every field one needs. A
  `journal_voucher` header would duplicate `journal_entry` row for row and give the two something to
  disagree about.
- **The voucher's identity is a caller-supplied id**, optional, defaulting to one the server
  generates. `journal_entry` is already unique on `(company, source_type, source_id)`, so a client
  that retries with the same id gets the same single entry rather than a second one — the same
  idempotency contract `document.source_id` gives external callers, for the same reason.
- **Any entry can be reversed.** A reversal is a new entry with the sides swapped, keyed
  `(REVERSAL, <the reversed entry's id>)` — so an entry can be reversed once and only once, enforced
  by the index rather than by a check. Its date is the caller's choice and defaults to today,
  because the original's period may well be closed, which is often exactly why it is being reversed.
- **Opening balances are a manual voucher**, not a feature: an entry dated the first day of the
  first period, debiting and crediting the figures carried in from the old books. Stated in the spec
  so the absence of a separate mechanism reads as a decision.

Deliberately **out of scope**:

- **Approval routing for a voucher.** Every other financial effect in this system passes an approval
  workflow, and a voucher is the most privileged write there is — so this omission is the one worth
  arguing about. It is out because the document route needs a line table that does not exist:
  `document_line` carries `line_amount`, not `debit` and `credit`, so a voucher through documents
  means a new table, a new form template, a new post-action and a workflow, roughly doubling the
  change. The compensating controls are real but they are *detection*, not prevention: every
  voucher is append-only, attributed to its poster, visible in the journal read, and correctable
  only by a reversal that is equally visible. `GL_JV_POST` should be granted to very few people
  until the approval route exists.
- **A voucher template or recurring schedule.** Depreciation every month wants one; it is a
  convenience over this, not a change to it.
- **Reversing a reversal.** Permitted by the model — a reversal is an entry like any other — but
  untested and unadvertised here.
- **Restating history.** This ships the tool. Which historical GRNI and expense figures deserve a
  correcting voucher is a bookkeeping judgement per company, and doing it from a change would be
  guessing at books nobody here can see.

## Capabilities

### New Capabilities

None. This is `gl-journal`'s ledger and its constructor; a manual entry is not a different kind of
journal.

### Modified Capabilities

- `gl-journal`: `Authorized, Company-Scoped Journal Read` stops claiming there is no write endpoint;
  a new requirement covers posting a voucher, and another covers reversing an entry.

## Impact

**Backend**

- `back/src/modules/gl/journal-voucher.service.ts` (new) — post and reverse. Resolves each line's
  account through `AccountService.resolvePostable`, then hands the draft to `createEntry`.
- `back/src/modules/gl/journal.controller.ts` — two endpoints, both `GL_JV_POST`.
- `back/src/modules/gl/dto/journal-voucher.dto.ts` (new) — the voucher and its lines, validated:
  at least two lines, each with exactly one non-zero side, money as strings.
- `back/src/modules/gl/gl-posting.service.ts` — `SOURCE_MANUAL` and `SOURCE_REVERSAL` beside the
  existing source types. No change to any posting path.
- `back/src/modules/gl/permissions.ts` — `GL_JV_POST`, picked up by `allPermissionCodes()`.
- No migration: no schema changes at all.

**Invariants**

- Invariant 2 holds and is the point: a voucher is appended, never edited, and a correction is a
  reversal. Nothing here can update or delete an entry.
- Invariant 3 and 6: a voucher writes no `budget_txn` and cannot. The budget is a separate book, and
  an accountant correcting the ledger is not adjusting anyone's budget.
- Invariant 1: lines resolve through the company-scoped account resolver, so a voucher cannot name
  another company's account.

**Risk**

This is the largest new privilege in the system, and it is guarded by a permission rather than by an
approval. The mitigation is that a voucher cannot do anything *quietly*: it is balanced or refused,
it cannot enter a closed period, it carries its author, and it stands in the journal read beside
every automatic entry. What it can do is state something untrue in an account that nobody reconciles
— which is a reason to grant the code narrowly and to build the approval route next, not a reason to
leave the ledger uncorrectable.

Second: a voucher is not recorded in `gl_posting_attempt` and should not be. That table tracks
postings the system owes itself; a voucher is a person's synchronous act that either succeeds or
returns them an error. Putting it there would make the undelivered-postings read — and therefore the
period close — answer a question about human work it cannot resolve.

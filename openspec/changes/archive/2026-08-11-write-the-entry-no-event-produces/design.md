## Context

The ledger has one author, and it is a machine.

```
payment.settled ──┐
approval.outcome ─┼─► posting engine ──► createEntry ──► journal_entry
stock.moved ──────┘                        │
settlement (inline) ───────────────────────┘

a person with a correction to make ──────► (nothing)
```

Every guarantee a manual entry needs is already enforced at the one door the engine uses:

| guarantee | already enforced by |
|---|---|
| balanced | `createEntry` |
| dated in the company's own day | `createEntry` → `entryDateFor` |
| refused in a closed period | `createEntry` → `PeriodGuardService` |
| account is real, active, postable, ours | `AccountService.resolvePostable` |
| append-only | `LedgerGuardSubscriber` |
| idempotent per source | `journal_entry` unique `(company, source_type, source_id)` |

So this change is a door, not a mechanism. Almost everything it needs is a consequence of decisions
made in the four changes before it.

## Goals / Non-Goals

**Goals:**

- A person can write the entry no event produces, under every rule the engine already obeys.
- A wrong entry can be corrected without being edited.
- A company with existing books can start using this system.

**Non-Goals:**

- Approval routing for a voucher. Argued in the proposal; the short version is that
  `document_line` has no debit and credit, so the document route is a second table and a second
  change.
- Editing or deleting an entry. Append-only is not negotiable and a reversal is the answer.
- Templates, recurring vouchers, or a restatement of existing history.

## Decisions

### D1 — The entry is the voucher; there is no header table

A `journal_voucher` table would carry a date, a memo, an author and a set of lines. `journal_entry`
carries a date, a memo, an author and a set of lines.

```
journal_voucher            journal_entry
  entry_date       ←→        entry_date
  memo             ←→        memo
  created_by       ←→        created_by
  lines            ←→        journal_line
  status?                    (append-only: there is no other state)
```

Nothing is left over. A second table would be a copy of the first with an opportunity to disagree
with it, and every read — the journal, the trial balance, the account ledger — would have to decide
which one it believed.

What a voucher needs beyond an automatic entry is only that its `source_type` says where it came
from: `MANUAL_JV`. The journal read already shows `source_type`, so "which of these did a person
write?" is answerable the day this ships, with no new field.

### D2 — The voucher's id is the caller's, and that is the idempotency

`source_id` must hold something. Three options:

| option | verdict |
|---|---|
| a server-generated uuid | rejected: a double-clicked confirm posts twice |
| a human reference like `JV-2026-08-001` | rejected: `source_id` is a uuid column, and a second unique key on a text field is a second identity |
| **a caller-supplied uuid, defaulted server-side** | **chosen** |

With a caller-supplied id, a retried request returns the same entry rather than a second one.
**Revised while implementing:** the first version said the unique index "does the work", and a test
showed it does not — a retry hitting the index gets a duplicate-key ERROR, not the entry it already
has. Idempotency is a lookup (`if (existing) return existing`, the shape every posting path uses);
the index is the backstop that stops two concurrent requests, not the mechanism. This is the contract
`document.source_id` already gives external callers — *"ยิงซ้ำจาก timeout ต้องได้เอกสารใบเดิม"* — and
reusing it means one idempotency story in the system rather than two.

A caller who supplies nothing gets a generated id and no protection, which is the honest default for
a request that did not ask for any.

### D3 — A reversal is keyed by what it reverses

```
original    (MANUAL_JV | PAYMENT | APPROVAL_ACCRUAL | …, <its own source id>)
reversal    (REVERSAL, <the original ENTRY's id>)
```

"An entry is reversed at most once" is checked before writing and backed by the unique index. The
check exists to give the caller a sentence rather than a constraint error; the index exists so two
concurrent requests cannot both get past the check. Neither a status column nor a lock is needed.

**Any** entry may be reversed, not only a manual one. A wrong automatic posting is the more likely
case, and refusing to reverse it would leave the very hole this change exists to close.

The reversal's date is the caller's, defaulting to today, and is deliberately **not** the original's:
the original's period is frequently closed — that is often why it is being reversed — and dating the
correction into a closed month would either be refused by the period guard or, worse, quietly
restate a month somebody has already reported. A correction belongs in the period in which it was
decided.

### D4 — Everything else is inherited, including what a voucher may not do

The service resolves accounts, builds lines and calls `createEntry`. It adds no rules of its own,
which is the point: a voucher and a payment posting are subject to the same ledger.

Two omissions are deliberate rather than incidental:

- **No `budget_txn`.** A voucher is accounting. An accountant correcting a misposted expense is not
  adjusting anybody's budget, and letting the ledger reach into the budget would break the one
  separation this system has held from the beginning (invariants 3 and 6).
- **No `gl_posting_attempt` row.** That table records postings the system owes *itself*, and the
  period close reads it to decide whether a month is drained. A voucher is a person's synchronous
  act: it either succeeds or returns them an error they can act on immediately. Recording it there
  would put human work into a queue built for machine work, and make a close wait on it.

## Risks / Trade-offs

**A voucher is the largest privilege in the system and has no approval.** Named in the proposal and
worth repeating: the controls here are detection, not prevention. A voucher is balanced, dated,
attributed, append-only, visible beside every automatic entry, and correctable only by an equally
visible reversal.

Attribution was *claimed* by the first draft and not implemented — `createEntry` never set
`created_by`, so no entry in the system had an author. It does now, for manual entries only: an
engine-posted entry has no author, and naming the approver or the payer would attribute a
bookkeeping act to somebody who did not perform one. That contrast is what makes a manual entry's
author mean something when the journal is read — but a determined or careless holder of `GL_JV_POST` can still misstate an account.
The mitigation is a narrow grant and the approval route as the follow-up. The alternative — leaving
the ledger uncorrectable — is worse, and was the status quo.

**A reversal is not a deletion, and reports will show both.** That is correct double-entry and will
still surprise someone: the account ledger shows the wrong entry and its reversal, netting to zero,
rather than showing nothing. It is the honest presentation and there is no other one available under
append-only.

**Opening balances have no special handling.** They are a voucher like any other, which means
nothing distinguishes "the books we carried in" from "an adjustment somebody made in year three".
A dedicated source type would give that, and is not built because nothing yet asks the question —
noted so that the first thing that does knows why it must look at dates rather than a flag.

## Migration Plan

None. No schema change, no new table, no backfill.

## Open Questions

- Whether a voucher should be restricted to accounts of certain types (refusing a direct write to a
  control account such as `ACCOUNTS_PAYABLE`, which a subledger owns). Standard practice in larger
  systems, and premature here: this system has no subledger tables, so every balance is already the
  journal's.

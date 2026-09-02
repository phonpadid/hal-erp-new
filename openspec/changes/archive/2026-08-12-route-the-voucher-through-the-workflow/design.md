# Design

## D1. The document carries the header; the voucher keeps the lines

The obvious shape is "a voucher IS a document, and its lines ARE document lines". It does not
survive contact with what routes the ladder.

`DocumentSubmitService` computes the amount the workflow bands against:

```ts
const total = lines.length
  ? lines.reduce((s, l) => Money.add(s, l.lineAmount), '0')
  : document.totalAmount ?? '0';
```

A voucher line has a SIDE. Every way of folding a side into a single `line_amount` produces the
wrong number for exactly the thing this change exists to get right:

| encoding | Σ line_amount | what the ladder does with it |
| --- | --- | --- |
| debit positive, credit negative | **0**, always — a voucher balances | every voucher routes in the lowest band, including the 50m one |
| both sides positive | **2×** the amount | every voucher routes one band too high |
| separate `debit`/`credit` columns on `document_line` | correct | two more nullable columns on a procurement table, used by one type, plus `line_amount` still has to hold something |

The third is survivable but pays for itself in the wrong currency: `document_line` carries `qty`,
`unit_price`, `tax_code`, `budget`, `item`, `received_qty` — the shape of a purchase — and the
generic submit path walks those lines to compute tax, reserve budget and check `requires_item`. A
voucher line would have to be excluded from each of those in turn, which is a branch on the type
inside the generic path, and invariant 7 says behaviour comes from configuration rather than a
branch on which type this is.

The same line of code offers the way out: **with no `document_line` rows at all, the total is
`document.totalAmount`**, which the voucher stamps as Σ debits. Then

```
document              (docNo, department, workflow, currentStepNo, totalAmount = Σ debits, no lines)
   │ 1:1
journal_voucher       (entry_date, memo, reverses_entry_id, document_id)
   │ 1:N
journal_voucher_line  (account, debit, credit, memo)
```

and the generic submit path never learns that vouchers exist. The tax loop iterates an empty
collection, the budget checks are skipped by `requires_budget = false`, `requires_item` /
`requires_vendor` / `requires_payee` / `requires_warehouse` are all false, and `approval_log`'s FK to
`document` is satisfied because the header genuinely is one.

This is also the shape the reference implementations use. In SAP a journal entry is a document with a
document type and its own number range, and its line items live in their own table with a
debit/credit indicator — not in the purchasing document's item table.

**What is given up:** two rows per voucher instead of one, and a join to read a voucher. Both are
cheap. The alternative buys one fewer table and pays with a special case in the code path every
other document type shares.

## D2. `totalAmount` is Σ debits, and the balance rule is what makes that unambiguous

Σ debits = Σ credits for any voucher that can exist, because balance is asserted at submit and again
in `createEntry`. So "the amount of a voucher" is not a choice — either side names it. It is stamped
on the document at create, and restamped whenever the lines change while the document is `DRAFT`.

`budgetBaseTotalAmount` is set to the same figure. The resolver prefers it, and a voucher is written
in the company's base currency, so the budget rate and the daily rate are both 1 and there is nothing
to diverge. A foreign-currency voucher is out of scope: nobody has asked for one, and inventing a
locked-rate story for a manual entry would be a guess about a requirement.

## D3. A closed period is refused before an approver is asked, not after

Today the posting happens inside the approval transaction:

```
act(APPROVE) ─┬─ append approval_log
              ├─ last step? → postAction.run(document, tem)   ← createEntry, period guard
              └─ commit
```

With one checker this is harmless: the approver hits an error, the transaction rolls back, and the
author withdraws and re-dates. With a ladder it is not. Five approvers pass a voucher, the month
closes, the sixth approves — and their approval is rolled back with an error about a period they did
not choose and cannot open. The four approvals below are still on the record, so the document is
stuck at a step whose approval can never commit.

The guard therefore moves forward, and runs three times:

1. **at submit** — a voucher already dated into a closed period is refused before it enters a queue;
2. **before each approval is accepted** — refused with the period named, and the message says the fix
   is for the author to withdraw and re-date, not for the approver to do anything;
3. **inside `createEntry`**, unchanged — it is the invariant, and a check in front of it is a
   courtesy, not a replacement.

Check 2 is deliberately in front of the `approval_log` insert, so a refused approval leaves no trace
of an approval that did not happen. It is not a race-free guarantee — a period can close between the
check and the commit — and that is exactly why 3 stays. What 2 removes is the *ordinary* case, not
the last microsecond of it.

## D4. `POST_JOURNAL` is a post-action, and the voucher is where it looks

`PostActionService.run` switches on `document_type.post_action`. A new case posts the voucher:

```
POST_JOURNAL → find journal_voucher by document → createEntry(
                 instant   = entry_date at midday, resolved to the company's day
                 sourceType= reverses_entry_id ? REVERSAL : MANUAL_JV
                 sourceId  = reverses_entry_id ?? voucher.id
                 createdById = document.createdBy      ← the preparer, not the last approver
               )
```

`paymentReady` stays false and no `budget_txn` is written, for the reasons the voucher always gave.
Idempotency is unchanged: `(company, source_type, source_id)` is unique on `journal_entry`, so a
retried approval resolves to the entry already written.

The author of the entry remains the SUBMITTER. An entry is what its preparer wrote; approvals are
control events about it, and they live in `approval_log` now instead of on the voucher row — which is
a strictly better place for them, because the log records every step rather than only the last.

## D5. Self-approval, withdrawal and rejection are inherited, not reimplemented

Three hand-written rules disappear into the engine:

| voucher rule today | engine equivalent |
| --- | --- |
| `createdBy === userId` → Forbidden | routing blocks the creator AND their delegator (invariant 8) — strictly stronger |
| `withdraw()` by the author only | `DocStatus.CANCELLED` on a document by its creator |
| `reject(reason)` with a required reason | `ApproveAction.REJECT` with a remark |

The delegation case is a real gain: today, an author who delegates to a colleague could have that
colleague approve their voucher, because the voucher check compares user ids only. Routing compares
the delegator too.

`JournalVoucherStatus` therefore goes away as a duplicate of `document.status`. Two status fields
that must agree is a synchronisation problem nobody needs; the voucher row keeps only what a document
cannot express — the accounting date and the reversed entry.

## D6. The department a voucher belongs to

`document.department` is NOT NULL, and a voucher has no natural department. It takes the preparer's,
which is also what pins the form template and the workflow through `dept_doc_type`.

The consequence is honest and should be said out loud: **a department with no `dept_doc_type` row for
`JV` cannot raise one.** That is a feature — it is how every other document type is scoped to the
departments that use it — and it means enabling vouchers for a department is a configuration act
rather than a deployment. The seed maps the accounting department only.

## D7. Vouchers already waiting when this ships

`journal_voucher` rows that are `PENDING` have no document, and after this change the approval path
reads documents. Two options: refuse to migrate while the queue is non-empty, or build the documents.

The migration builds them. A deployment that requires an empty approval queue is a deployment that
gets done at 3am or gets skipped, and the data needed is all present — the company, the author, the
author's department, the total from the lines. Each pending voucher gets a document of the `JV` type
in `SUBMITTED`, routed from the first applicable step, so a checker sees it in the inbox where they
now look for it.

Vouchers already `APPROVED`, `REJECTED` or `WITHDRAWN` get a document too, in the matching terminal
status, so the history reads uniformly — an approved voucher with no document would be a voucher
whose entry cannot be traced back to a route.

The `down()` migration cannot un-post anything and does not try. It drops the link column; the
documents it created stay, because deleting documents that carry `approval_log` rows would destroy an
append-only audit trail to undo a schema change (invariant 2).

## D8. What the screens become

The voucher FORM stays bespoke. Its value is watching the two totals converge while typing, which a
`form_template`-driven generic form cannot do, and the form is what `GL_JV_POST` gates. It submits a
document instead of a voucher.

The pending-vouchers screen becomes redundant with the approvals inbox and is kept anyway, as a
filtered view: a checker looking at a voucher wants the lines and the account names, which the
generic approval card does not show. It reads from the document side so it shows the step a voucher
is on and who it is waiting for — information it could not show before, because there was only ever
one step.

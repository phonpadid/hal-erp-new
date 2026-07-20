## Context

Today the chain ends at a derived, read-only queue. `PaymentHandoffService.readyToPay` lists
`COMPLETED` documents whose type's `post_action` is `CUT_BUDGET` and that have no `payment` row;
`PaymentService` then records one payment per document at a finance-supplied actual rate,
computing the FX delta against the rate locked at submit. The queue was built so an *external*
accounting system could pull payables — nothing in the ERP was ever meant to talk to a bank.

Three facts from the current code shape everything below:

- **`vendor` has no bank fields.** `Vendor` (`master-data.entities.ts:7`) carries code, name,
  taxId, address, contact, `paymentTermDays`. There is no account number anywhere in the schema.
- **`Vendor` is group-level** (`BaseEntity`, not `CompanyScopedEntity`); `vendor_company` is the
  per-company link, and it already models a per-company override (`paymentTermDays`).
- **`payment` is 1:1 with `document`** via `@Unique({ properties: ['document'] })`, and the queue
  is derived from the *absence* of that row. This is load-bearing: it is both the double-pay
  guard and the requeue mechanism, for free.

The budget is fully settled before any of this runs. `post-action.service.ts` `cutBudget` walks
`ref_document_id` back to whoever holds the `RESERVE` and calls `budget.settle`, which inserts
`ACTUAL` plus a `RELEASE` for the remainder, inside the approval transaction. By the time a
document reaches the queue, its budget story is over.

## Goals / Non-Goals

**Goals:**
- Give a vendor many bank accounts, and gate changing them behind their own permission code.
- Bind the payee account to the disbursement so it passes through the approval chain.
- Export a CSV of selected payables and keep the exact bytes that went to the bank.
- Import the bank's result and create payments from it, reusing existing FX/WHT semantics.
- Make a rejected line reappear as payable without any requeue code.

**Non-Goals:**
- Fixed-width and ISO 20022 output (a formatter seam is built; the formats are not).
- Automatic FX rate lookup at import — finance keys the actual rate per line.
- Direct bank API/host-to-host connectivity. A human still moves the file both ways.
- Payees that are not vendors (employee advances, petty cash).
- Any change to how budget is reserved, settled, or released.

## Decisions

### Bank accounts live on the group `vendor`, not on `vendor_company`

Per the product decision, `vendor_bank_account.vendor_id → vendor.id`. One vendor's accounts are
therefore shared by every company in the group.

*Consequence to accept knowingly:* invariant 1 says data never crosses companies except for
GROUP-scope reads. This is such a read, but a wide one — company A's finance user picking a payee
sees an account row that company B created. It is a read, never a write across companies, and
`vendor` itself is already group-level, so an account is no more shared than the vendor's name or
tax ID. *Alternative rejected:* accounts on `vendor_company`, mirroring the `paymentTermDays`
override. That isolates better but forces every company to re-enter the same account numbers for
a shared supplier — more retyping, which is the exact problem this change exists to remove.

### `VENDOR_BANK_MANAGE` is a separate permission from `MASTER_MANAGE`

Changing a payee account is the highest-leverage fraud action in the system: it needs no
approval, leaves no document, and pays out on the next run. Anyone who can edit a vendor's phone
number MUST NOT thereby be able to redirect its money. *Alternative rejected:* reuse
`MASTER_MANAGE` — simpler, and wrong for exactly the reason above.

Mutations to `vendor_bank_account` are additionally recorded, since the table is not append-only
and an attacker's best move is to edit an account, run the batch, and edit it back.

### The payee gate is its own config flag, not a reading of `post_action`

`document_type` gains `requires_payee` (default `false`), and `document.vendor_bank_account_id` is
nullable in the schema but REQUIRED at submit when that flag is true. Validation belongs in
`DocumentSubmitService` next to the existing `requiresVendor` gate — the account must belong to
the document's vendor and be active *at submit*.

*Alternative rejected:* gate on `post_action === 'CUT_BUDGET'`, which looks equivalent and is not.
The seeded `PR` type carries `CUT_BUDGET` (`seed-data.ts:479`) precisely so a requisition can
settle its own reservation — but nobody knows the payee account when raising a requisition, so that
gate would block every PR submit. `post_action` answers "what does full approval do to the budget";
the payee question is "does this document name a destination for money". Conflating them is exactly
the hardcoded per-type branching invariant 7 forbids. With a flag, `DISB` sets `requires_payee` and
`PR` does not, and a future type can need a payee without cutting budget.

### The payee is chosen on the disbursement and frozen at submit

This is the control point. A batch built by finance can only ever pay where the approvers
already agreed to pay. *Alternative rejected:* pick the account at batch time, defaulting to
`is_primary` — more flexible when an account closes mid-approval, but it hands one finance user
unilateral control of the destination after 6–7 people signed off on the amount. Not worth it.

*Accepted cost:* if the chosen account is deactivated between submit and export, the batch cannot
be built and the document must be returned and resubmitted. The export SHALL fail loudly with the
offending line rather than silently substituting the primary account.

### Batch lines snapshot the payee; they do not reference it live

`payment_batch_line` copies bank code, account number, account name, and amount at `DRAFT` time.
Once `EXPORTED`, the line is immutable. A live join would let a later edit to
`vendor_bank_account` rewrite history and make the stored CSV disagree with the database — the
snapshot is what makes the artifact auditable.

### The queue excludes documents on an open batch

`readyToPay` currently subtracts documents that have a `payment`. A `DRAFT`/`EXPORTED` batch line
has no payment yet, so without a change the same payable is selectable into a second batch and
pays twice at the bank — the `payment` unique constraint would catch it only at import, long
after the money moved. The queue SHALL also subtract documents on a non-terminal batch.

### Import: one transaction, per-line outcomes, no partial rollback

The result upload parses the CSV, then in a single `em.transactional`: for each `SUCCESS` line
create a `payment` via the existing `PaymentService` (so FX delta and WHT are computed exactly
once, in one place); for each failed line record the bank's reason and leave the document without
a payment. A malformed **file** aborts everything; a rejected **line** is data, not an error.

*Sequence note (rules require one for budget/quota writes):* **this flow writes neither
`budget_txn` nor `quota_usage`, by design.** The budget was settled at `CUT_BUDGET` on full
approval, at the locked BUDGET_RATE basis. The FX delta discovered at import is accounting's
problem and rides the `payment.settled` event — writing it to the budget would recompute a locked
rate and violate invariant 6. There is consequently no budget lock to take here: the transaction
boundary exists to keep the batch's status and its payment rows consistent, nothing more. The
only pessimistic lock is `SELECT FOR UPDATE` on the `payment_batch` row itself, serializing two
finance users uploading a result for the same batch at once.

Re-uploading the same result file is safe rather than clever: `@Unique({ properties: ['document'] })`
on `payment` rejects the second insert. The importer SHALL treat an already-paid line as a
no-op and report it, not as a crash.

### WHT moves to the batch line

The exported amount must be net of withholding, so the tax code has to be known before the file
is written — earlier than `POST /payments/:documentId` accepts it today. `payment_batch_line`
carries `wht_tax_code_id`; at import it is passed through to the unchanged `PaymentService`. The
existing single-payment endpoint keeps its own WHT parameter for the manual path.

### CSV is emitted through a formatter seam

A `BankFileFormatter` interface (`format(lines): string`) with one `CsvBankFileFormatter`
implementation, selected per batch by a stored `format` discriminator. No CSV or XML library is
added — the writer is a join, and the reader is a split with quoted-field handling. This keeps
fixed-width and pain.001 additive later, per invariant 7 (configuration over code), without
pretending to design formats we have not seen.

## Risks / Trade-offs

**A deactivated payee account blocks an approved payment** → Export fails with the specific
document and account named, so finance knows to have it returned and resubmitted. Silently
falling back to the primary account would defeat the entire control.

**Group-shared accounts widen cross-company visibility** → Reads only, never writes; `vendor` is
already group-level. Revisit by moving the table to `vendor_company` if a tenant objects — the
snapshot on `payment_batch_line` means historical batches survive that migration intact.

**Finance keys the actual rate by hand at import** → A typo becomes a wrong FX delta in
accounting (never in the budget — invariant 6 contains the blast radius). Mitigate by defaulting
each line's rate to the locked rate and validating a sane band.

**A batch stuck in `EXPORTED` after the file was really sent** → The documents stay out of the
queue and go unpaid with no visible error. Mitigate with an explicit cancel that returns lines to
the queue, and by surfacing batch age in the UI.

**Double payment at the bank if a batch is exported twice** → The stored artifact plus an
`EXPORTED` status make re-download idempotent (same bytes, same batch); the queue exclusion stops
a second batch from forming. The bank-side control (file reference / duplicate detection) is
outside our reach and is a documented residual risk.

**`CREATE_SUCCESSOR` fails silently** (`post-action.service.ts:107-109` swallows all errors,
post-commit) → Pre-existing, not introduced here, but it sits upstream of every DISB on the
PROC→PO→DISB path: a PO that never materialized means a payable that never appears. Out of scope;
flagged for its own change.

## Migration Plan

1. Additive migration: create `vendor_bank_account`, `payment_batch`, `payment_batch_line`; add
   `document.vendor_bank_account_id` (nullable) and `payment.batch_id` (nullable). Nothing
   backfills — existing documents have no payee account and are already paid or still queued.
2. Update `erp_approval_system.dbml` to match, and correct the stale `post_action` note
   (`CREATE_PO` no longer exists; the three budget actions are missing).
3. Register `VENDOR_BANK_MANAGE`, `PAYMENT_BATCH_VIEW`, `PAYMENT_BATCH_MANAGE`; seed them onto
   the roles that already hold `PAYMENT_MANAGE`.
4. Ship with `requires_payee` false on every type, so the submit gate is inert. Enter vendor
   accounts, then flip the flag per type — `DISB` first. The flag turns a big-bang migration into
   an opt-in, which is most of the reason it exists.

*Rollback:* the tables are additive and the columns nullable; clearing `requires_payee` disables
the gate without a deploy, and reverting the code restores current behavior with no data loss.
Batches already exported become orphaned records, which is why the batch endpoints and the flag
flip are separate steps.

## Open Questions

- **Which CSV columns, in what order?** *Resolved provisionally.* No bank is fixed yet, so the
  format is ours to define: export is `bank_code, account_no, account_name, amount, currency,
  reference`, and the result is `reference, status, reason`. Shipped so the feature works today;
  a real bank spec means editing `CsvBankFileFormatter` alone. **Verify against the bank's own
  specification before the first live run.**
- **Does the bank echo a reference back?** *Resolved by defining it:* we emit the batch line's id as
  `reference` and match the result on it. Matching on account number and amount instead would be
  ambiguous the moment one vendor is paid twice for the same amount in one run — exactly when a
  mismatch costs money. A bank that will not echo a reference would force that heuristic back, and
  is worth knowing about early.
- **Should `payment_batch` require its own approval** before export? Currently `PAYMENT_BATCH_MANAGE`
  alone can send the file. The amounts are all pre-approved, but the *run* is not.
- Should an account carry a currency and be filtered against the document's currency, or is that
  the bank's problem?

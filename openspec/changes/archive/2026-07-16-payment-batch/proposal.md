## Why

A disbursement that clears its full approval chain lands in the ready-to-pay queue and then
stops: finance reads the queue, retypes every vendor account number into the bank's portal by
hand, and marks each document paid one at a time. The retyping is the control gap — the amounts
and approvals are trustworthy right up to the point where a human copies an account number, and
nothing in the system records which bank file a payment actually went out on.

This change closes the loop: select payables, export a bank file, upload the bank's result back,
and record the payments from it. It also fixes the precondition that makes any of this possible —
`vendor` today has **no bank account fields at all**, so there is nothing to pay into.

## What Changes

- **New `vendor_bank_account` table** — a vendor MAY hold many accounts (bank code, account no,
  account name, currency, `is_primary`, `is_active`). Managed under a **new, separate**
  `VENDOR_BANK_MANAGE` permission code, deliberately not folded into `MASTER_MANAGE`: altering a
  vendor's payee account is the classic ERP fraud vector and MUST NOT ride along with routine
  vendor edits.
- **New `document_type.requires_payee` flag** (default `false`) — a type that needs a payee says
  so in configuration, rather than the code inferring it from `post_action`. The seeded `PR` type
  carries `CUT_BUDGET` too, so inferring would block every requisition submit; per invariant 7 the
  behavior is a flag, not a branch.
- **Payee account is chosen on the disbursement, not at payment time.** `document` gains a
  nullable `vendor_bank_account_id`, required at submit when the type's `requires_payee` is true.
  The account therefore passes through the same 6–7 approval steps as the amount — approvers see
  where the money lands. Finance CANNOT redirect an approved payment.
- **New `payment_batch` + `payment_batch_line` tables** — a company-scoped payment run: select
  from the ready-to-pay queue → `DRAFT` → export CSV → `EXPORTED` (lines frozen) → upload the
  bank's result → `COMPLETED` / `PARTIAL`.
- **CSV export** with a configurable column mapping, written to S3 via the existing
  `StorageService` under a new `payment-batches/{batchId}/…` layout, so the exact bytes sent to
  the bank stay auditable. No new parsing dependency.
- **Result import** creates one `payment` per succeeded line inside a single transaction, reusing
  the existing `PaymentService` so FX gain/loss and WHT keep their current semantics. Finance
  keys the actual rate per line at upload (the CSV result carries no rate).
- **WHT selection moves earlier** — from `POST /payments/:documentId` to the batch line, because
  the exported amount MUST be net of withholding. **BREAKING** for the existing
  `POST /payments/:documentId` body, which keeps working for the manual single-payment path.
- Failed lines need no requeue logic: the queue is derived from "has no `payment` row", so a
  document whose line the bank rejected reappears on its own.

## Capabilities

### New Capabilities
- `vendor-bank-account`: many bank accounts per vendor, primary selection, activation, and the
  `VENDOR_BANK_MANAGE` permission that gates them.
- `payment-batch`: the batch lifecycle (`DRAFT` → `EXPORTED` → `COMPLETED`/`PARTIAL`), CSV
  export with a stored artifact, and result import that creates payments.
- `web-payment-batch`: the finance UI — build a batch from the queue, download the file, upload
  the result, review per-line outcomes.

### Modified Capabilities
- `payment-handoff`: the ready-to-pay queue SHALL exclude documents already on an open batch
  (otherwise the same payable is exportable twice); WHT moves to the batch line; `payment` gains
  a nullable `batch_id` linking it to the run that produced it.
- `document-engine`: `document_type` gains `requires_payee`; a document of such a type SHALL carry
  a `vendor_bank_account_id`, validated at submit — the account must belong to the document's
  vendor and be active.
- `web-documents`: the disbursement form gains a payee-account selector, shown only for types
  whose `requires_payee` is true.

## Impact

**Invariants.** No `budget_txn` row is written anywhere in this change. The budget is already
settled (`ACTUAL` + `RELEASE`) when the `CUT_BUDGET` document completes, so a batch never touches
a ledger — invariant 6 (FX gain/loss goes to accounting, not the budget) holds unchanged, and
invariant 2 (append-only) is not in play. `payment`'s existing `@Unique({ properties: ['document'] })`
already makes a duplicate result upload a no-op rather than a double payment.

**Company isolation.** `payment_batch` is company-scoped. `Vendor` is group-level
(`BaseEntity`), so `vendor_bank_account` hangs off the group vendor and is visible across
companies — a deliberate GROUP-scope read under invariant 1, called out here because it is a
widening, not an accident. The design must decide whether that is acceptable or whether accounts
belong on `vendor_company`.

**Schema.** 3 new tables + 2 columns; `erp_approval_system.dbml` must be updated (it is the
canonical model). Note the DBML's `document_type.post_action` note is already stale — it lists
`CREATE_PO`, which no longer exists, and omits the three budget actions; worth correcting in the
same pass.

**Code.** `back/src/modules/payment-handoff/` (queue filter, `payment.batch_id`, WHT source),
`back/src/modules/master-data/` (vendor accounts), `back/src/modules/document/`
(submit-time payee validation), `back/src/common/storage/` (new key layout),
`front-end/src/views/payments/`. No new npm dependency — CSV is emitted and parsed directly.

**Out of scope.** Fixed-width and ISO 20022 formats (the CSV writer is kept behind a formatter
seam so they can be added without schema change); automatic rate lookup at import; paying
non-vendor payees (employee reimbursements).

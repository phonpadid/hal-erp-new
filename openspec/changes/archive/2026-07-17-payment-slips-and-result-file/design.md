## Context

The pay flow ends at `payment`: a settled `CUT_BUDGET` document is either paid one at a time
from the ready-to-pay queue (`PAYMENT_MANAGE`, actual rate keyed in) or through a
`payment_batch` — export a bank file, upload the bank's answer, and one `payment` is written per
succeeded line. `payment` carries the money facts (locked rate, actual rate, FX delta, WHT) but
nothing that shows the transfer happened, and no table references it for evidence.

Two constraints shape this design:

1. **`payment_batch` already accepts a result file.** `POST /payment-batches/:id/result-file`
   exists, takes a multipart file with a `rates` JSON map, parses it, and refuses what it cannot
   read. `web-payment-batch` already *requires* the web app to use it. Only
   `api/payments.ts` and `PaymentBatchDetailView` are missing — no backend or spec work.
2. **`document_attachment` is the house pattern for evidence.** Metadata in Postgres, bytes in
   S3/MinIO, `file_path` holding the key, upload gated per parent, and `document-engine` already
   specifies "store attachment metadata in `document_attachment` and keep file bytes out of the
   database". A payment slip is the same shape and should not invent a second one.

## Goals / Non-Goals

**Goals:**
- Attach many slips to one payment, list and download them, and delete one under a distinct
  permission.
- Close the result-file gap in the web client so the bank's file, not a typist, decides which
  payables were paid.
- Reuse the existing attachment plumbing (storage helpers, upload validation, size limits).

**Non-Goals:**
- Reading anything *out* of a slip — it is evidence for a human, never parsed. The result file
  (a different file, in the opposite direction) remains the only file the system interprets.
- Requiring a slip. A payment is valid without one; this is evidence, not a gate.
- Touching `budget_txn` or `quota_usage`. The budget settled to ACTUAL when the document
  completed; evidence and result parsing settle nothing (invariants 2, 3, 4).
- Removing manual per-line entry. A bank that returns no usable file must still be recordable.

## Decisions

### A new `payment_attachment` table, not a column on `payment`

The answer is "many files per payment", so a column cannot hold it, and a JSON array of keys
would put file metadata beyond the reach of the query planner and the FK graph. A child table
mirrors `document_attachment` field for field (`file_name`, `file_path`, `file_size_kb`,
`mime_type`, `uploaded_by`, `uploaded_at`) so both read the same way.

*Alternative considered:* reuse `document_attachment` by hanging slips off the disbursement
document. Rejected — a document's attachments are the requester's evidence, visible and editable
before approval, and the payee is fixed at submit precisely so nobody can restate the payment
afterwards. Mixing "what was requested" with "what the bank did" in one list would blur that,
and a slip must not appear where a requester can attach to it.

### Scoped through `payment`, carrying `company_id` anyway

`document_attachment` has no `company_id` and scopes through its document; `payment_batch_line`
carries one. This follows `payment_batch_line`: the queries that matter here start from the
company (list every slip for the company's payments in an audit), and invariant 1 asks main
tables to filter by company first. The parent's `company_id` is still authoritative — the
column is a denormalized index target, and inserts copy it from the payment rather than trusting
the request.

*Alternative considered:* no `company_id`, join through `payment`. Rejected — it makes the
common audit read a two-table join and leaves company isolation dependent on every caller
remembering the join.

### `PAYMENT_SLIP_DELETE` as its own permission

Deleting evidence of a transfer is not the same act as recording one. Granting it separately
lets a company give finance officers `PAYMENT_MANAGE` (record + attach) while reserving removal
for a head. The code is checked with `@RequirePermissions` like every other endpoint, not
inferred from a role name (invariant 5).

*Alternative considered:* append-only, no delete at all — consistent with `budget_txn` and
`approval_log`. Rejected because those are *ledgers* whose corrections are new rows; a slip is a
file, and the realistic failure is uploading the wrong customer's slip, which is a privacy
problem that a compensating upload cannot fix. Deletion is therefore allowed, but narrowly.

### Delete removes the row and the object

A row without bytes is a broken download; bytes without a row are unreachable and still hold
customer data. The service deletes both inside one `em.transactional`, removing the object after
the row commits — an orphaned object is recoverable by a sweep, whereas deleting the object
first and failing the commit leaves a row pointing at nothing.

### Evidence is attached at payment and read from the document

There is no payment page and no route to one: the pay surface is a queue of things *not yet*
paid, and a disbursement drops out of it the moment it is paid. Attaching a slip only there
would make it unreadable a minute later, which defeats the point of keeping evidence. So the
upload sits in the record confirmation — the moment the slip is in hand — and the reading happens
on the disbursement document, which is where an auditor already goes and which survives payment.

*Alternative considered:* a `/payments/:documentId` detail page. Rejected for now — it needs a
route, a page, and a way in, and nothing links to a paid disbursement except its document. If
payments grow their own facts worth a page (a remittance history, a reversal), that page becomes
worth building, and the slips move to it without a data change.

### The result-file upload sits beside the manual entry, not on top of it

`PaymentBatchDetailView` gains a `FileUpload` that posts to `result-file`, sending the per-line
rates the user has already keyed as the `rates` map. The existing per-line grid stays: it is how
the rates are entered, and it is the fallback when the bank's file is unreadable. The file
decides *which lines succeeded*; the user still supplies *the rate they are booked at*, exactly
as the endpoint's contract describes.

## Risks / Trade-offs

- **A slip is unvalidated content the app will serve back** → serve downloads through the same
  presigned-URL path as document attachments rather than proxying bytes, and store what the
  existing `validateUpload` accepts. Nothing renders a slip inline as HTML.
- **`company_id` denormalized onto a child table can drift from its parent** → it is written
  from the payment at insert and never from the request body; a payment cannot change company.
- **The result file and the manual grid can disagree** (the file says FAILED, the typist ticked
  SUCCESS) → the file wins for outcomes; the grid contributes only rates. Importing a file marks
  the batch from the file's contents, and the existing pessimistic lock on the batch row keeps
  two concurrent imports from interleaving.
- **`PAYMENT_SLIP_DELETE` seeded to nobody would make slips undeletable in existing companies**
  → seed it to the same roles that hold `PAYMENT_MANAGE` today, so behaviour starts where an
  admin expects and can be tightened per company.

## Migration Plan

1. Add `payment_attachment` to `erp_approval_system.dbml`, then a migration creating the table
   with FKs to `payment` and `company` and an index on `payment_id`.
2. Insert the `PAYMENT_SLIP_DELETE` permission and grant it to the roles that currently hold
   `PAYMENT_MANAGE`.
3. Ship backend endpoints, then the client. Both are additive: an older client keeps working,
   and a payment with no slips reads exactly as it does today.

Rollback: the table is additive and nothing reads it on the pay path, so dropping it (and the
permission grant) restores current behaviour without touching `payment`.

## Open Questions

- Should a slip be attachable to a payment created by a *batch* import, where one file from the
  bank often covers many payments? The design allows it (slips hang off each `payment`), but a
  single bank advice covering fifty payments would have to be uploaded fifty times. If that is a
  real workflow, a batch-level slip is a follow-up change, not a reason to move the table.
- Is there a retention rule for slips (how long must evidence be kept)? Nothing in the specs
  says, and nothing here expires them.

## Why

Two gaps sit at the end of the pay flow. First, nobody can attach proof that money moved: a
finance officer records a payment and the bank's transfer slip has nowhere to live, so an
auditor asking "show me the evidence for this payment" has to leave the system. Second, the web
app never grew the result-file upload its own spec already requires — finance keys each line of
the bank's answer by hand, so a fifty-line run is fifty chances to mistype which payable was
paid, while the file that already holds those answers sits unread on the desktop.

## What Changes

- **New**: a payment carries evidence — a `PAYMENT_MANAGE` user uploads one or more slips
  (image/PDF) against a recorded payment, and any `PAYMENT_VIEW` user can list and download them.
- **New**: a `PAYMENT_SLIP_DELETE` permission. Removing evidence is a stronger act than
  recording a payment, so it does not ride along with `PAYMENT_MANAGE` and is granted separately.
- **New**: slips are stored like document attachments — metadata in the database, bytes in
  object storage, keys never exposed to the client.
- **Fix (no requirement change)**: wire the bank result-file upload into the batch detail page,
  calling the existing `POST /payment-batches/:id/result-file`. `web-payment-batch` already
  requires this and the endpoint already parses the file; only the client is missing. Manual
  per-line entry stays as the fallback for a bank that returns no usable file.

## Capabilities

### New Capabilities
- `payment-slip`: uploading, listing, downloading and deleting the evidence files attached to a
  recorded payment, including their storage, company scoping, and permission rules.

### Modified Capabilities
- `web-payments`: adds a requirement for the slip UI on the ready-to-pay flow — uploading a slip
  after recording a payment, and viewing the slips already attached.

## Impact

- **Data model**: a new `payment_attachment` table (many per `payment`, company-scoped),
  mirroring `document_attachment`. Requires a DBML entry and a migration.
- **Permissions**: a new `PAYMENT_SLIP_DELETE` code, seeded to the roles that hold it today.
- **Backend**: a payment-attachment upload/list/delete endpoint set in the payment-handoff
  module, reusing the existing S3/MinIO helpers and upload validation.
- **Frontend**: slip upload/list on the payment flow, reusing `AttachmentUploader`; a file
  upload on `PaymentBatchDetailView` calling `result-file`, plus a new `importResultFile` in
  `api/payments.ts`.
- **Not affected**: `budget_txn` and `quota_usage` — evidence and result parsing settle nothing.
  The budget was already settled when the document completed.

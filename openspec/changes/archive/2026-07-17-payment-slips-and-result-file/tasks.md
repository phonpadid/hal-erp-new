## 1. Result file into the web client (no spec change — closes an existing requirement)

- [x] 1.1 Add `importResultFile(id, file, rates)` to `front-end/src/api/payments.ts`, posting multipart `file` plus `rates` as a JSON map of documentId → actual rate
- [x] 1.2 Add a file upload to `PaymentBatchDetailView` for an `EXPORTED` batch that sends the per-line rates already keyed in the grid, keeping the manual import as the fallback for an unreadable bank file
- [x] 1.3 Show the parse failure returned by the server (which document/line it choked on) rather than a generic error, and leave the batch untouched when a file is rejected
- [x] 1.4 Test: a successful file import completes the batch and records one payment per succeeded line; an unparseable file aborts the whole import and writes nothing

## 2. Data model

- [x] 2.1 Add `payment_attachment` to `erp_approval_system.dbml` (`id`, `company_id`, `payment_id`, `file_name`, `file_path`, `file_size_kb`, `mime_type`, `uploaded_by`, `uploaded_at`; index on `payment_id`), mirroring `document_attachment`
- [x] 2.2 Add the MikroORM entity and a migration creating the table with FKs to `payment` and `company`, matching the DBML exactly
- [x] 2.3 Seed the `PAYMENT_SLIP_DELETE` permission and grant it to the roles that currently hold `PAYMENT_MANAGE`

## 3. Slip backend

- [x] 3.1 Add a payment-attachment service in the payment-handoff module: upload (copying `company_id` from the payment, never from the request), list, and delete
- [x] 3.2 Delete removes the row and its stored object in one unit of work, removing the object after the row commits
- [x] 3.3 Add the endpoints — upload gated on `PAYMENT_MANAGE`, list/download on `PAYMENT_VIEW`, delete on `PAYMENT_SLIP_DELETE` — reusing the existing upload validation and size limits
- [x] 3.4 Return each slip with a presigned download URL and never its `file_path`
- [x] 3.5 Test: company isolation (another company's payment is refused), `PAYMENT_MANAGE` alone cannot delete, an oversized file writes no row, and no `budget_txn` row is written by any slip operation

## 4. Slip UI

- [x] 4.1 Add the slip API calls to `front-end/src/api/payments.ts`
- [x] 4.2 Build a `PaymentSlips` panel: list with download links, an explicit "no slip attached" state, upload behind `PAYMENT_MANAGE`, delete behind `PAYMENT_SLIP_DELETE`
- [x] 4.3 Mount it in the record confirmation (attach at payment) and on a paid disbursement's document (read after it leaves the queue)
- [x] 4.4 Test: the controls follow the permission codes, an upload lands on the document it was opened from, and a never-paid document shows no panel

## 5. Verify end to end

- [x] 5.1 Drive the app: record a payment, attach two slips, download one, delete one as a `PAYMENT_SLIP_DELETE` user, and confirm a `PAYMENT_MANAGE`-only user sees no delete control
- [x] 5.2 Drive the app: export a batch, import the bank's result file, and confirm the payments it records match the file rather than anything typed
- [x] 5.3 Confirm in the database that `budget_txn` is unchanged by every step above

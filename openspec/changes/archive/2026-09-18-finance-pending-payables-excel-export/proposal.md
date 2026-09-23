## Why

Finance keeps a spreadsheet of **what has been asked for and not yet paid** (`ລາຍຈ່າຍຄ້າງໃໝ່`),
grouped by department, one column per currency, and the head reads it to decide what is paid first.
Today that sheet is typed by hand from the documents screen: every row the system already knows is
re-keyed, and the sheet is stale the moment the next document is submitted. The system now holds
everything the sheet says except the decisions finance writes on it — so the sheet should come out
of the system, and finance should only write what is theirs to decide.

## What Changes

- The documents list gains an **Export to Excel (finance)** action that produces the finance sheet
  as an `.xlsx` workbook: title row, one column per currency the company uses (LAK / THB / USD /
  CNY as in the sheet finance keeps today, driven by the currencies present rather than hardcoded),
  rows grouped under their top-level department with a subtotal per group, a grand total per
  currency, the payee's bank (`vendor_bank_account.bank_code`) where the document names one, and
  blank columns for what finance decides (finance number, main / reserve account, remark).
- The export takes **the same filters as the list** — status, date range, department, type,
  vendor, number, amount — and sees the same rows the caller's `DOC_VIEW` scope allows. With no
  status given it exports what is **pending** (`SUBMITTED` / `IN_APPROVAL`), because that is the
  sheet finance builds; the head can widen it to `COMPLETED` or narrow to one department without a
  second endpoint.
- The **department number** column (`ເລກທີພະແນກ`) is written as `<running>/<type>/<department>`,
  the shape the paper stamps carry (`1034/ຈຊຈ/ບຫ`). The running part comes from the document
  number the system already issued; the two abbreviations are **new configuration** — a
  `short_name` on `document_type` and on `department` — falling back to the type `code` and
  `dept_code` where none is set, so nothing is hardcoded per company (invariant 7) and the sheet
  works on day one.
- The **description** column (`ລາຍການ`) is the document's line descriptions; a document whose lines
  say nothing falls back to its form's text field, stripped of markup and cut to one line, so a
  disbursement letter is summarised rather than blank.
- The **date** column is the date the requester submitted (`submitted_at`), which is when the
  document reached finance's queue; the amount is the document's `grand_total` in its own currency,
  placed under that currency's column and never converted or summed across currencies.
- Money is written as **strings** into the cells (the workbook library formats them as numbers on
  the sheet; the wire and the server never carry them as a JS number).

Deliberately NOT in this change:

- **Recording the head's ordering or finance's account choice in the system.** The sheet is where
  those decisions are made today, and the ask is the sheet. Those columns are exported blank for a
  person to fill. If they should later live in the system, that is a queue-ordering feature, not an
  export one.
- **Pre-filling main / reserve from `bank_account`.** That table holds no rows in practice; the
  sheet should not wait on a data-entry project. (The bank column is the *payee's* bank, which the
  document already carries — a different fact.)

## Capabilities

### New Capabilities

- `payables-worksheet-export`: a company-scoped, `DOC_VIEW`-gated Excel export of the filtered
  documents list in finance's payables-sheet layout — its columns, grouping, subtotals, currency
  columns, number format and the blank decision columns.

### Modified Capabilities

- `document-engine`: `document_type` gains an optional `short_name` (the abbreviation stamped in a
  document's paper number), read and written with the type, unique-ness not required.
- `multi-company`: `department` gains an optional `short_name` for the same purpose.
- `web-doc-config`: the document-type form offers the `short_name` field.
- `web-org-admin`: the department form offers the `short_name` field.
- `web-documents`: the list's filter bar offers the export action, sending the current filters.

## Impact

- **Data model**: `erp_approval_system.dbml` — `short_name varchar` on `document_type` and on
  `department`; one migration, two nullable columns; no ledger table touched.
- **Backend**: `DocumentType` / `Department` entities and their DTOs; a new
  `GET /documents/export/payables.xlsx` on the document controller reusing `DocumentListQueryDto`
  and `DocumentService.visibleWhere`; a worksheet builder on `xlsx@0.18.5` (already a dependency,
  used by the plan / chart importers); the HTML-stripping helper the PDF service already has, moved
  where both can reach it.
- **Frontend**: `DocumentsListView` filter bar (an export button under `DOC_VIEW`), `documentsApi`
  (a blob download), the document-type and department admin forms, Zod schemas in `@erp/shared`,
  i18n in `en`, `la`, `zh`.
- **Invariants**: none at risk. The export is read-only (no `budget_txn`, no `approval_log`), runs on
  the company-scoped EM and the reader's `DOC_VIEW` scope exactly as the list does (invariant 1,
  5), carries money as decimal strings and never converts across currencies (no FX arithmetic,
  invariant 6). Both abbreviations are configuration with a code fallback, not per-company logic in
  code (invariant 7).

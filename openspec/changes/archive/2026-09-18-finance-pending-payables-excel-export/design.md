## Context

Finance's payables sheet (`ລາຍຈ່າຍຄ້າງໃໝ່ປະຈຳປີ 2026`) is a single Excel sheet: title, a Lao
header row, rows grouped under a department heading, four currency columns, a `SUM` at the bottom,
and five columns finance fills in by hand (finance number, bank, main / reserve account, remark).
The head reads it to decide what is paid first.

What the system holds today, checked against the production restore on `:5433`:

- The list endpoint already filters by everything the sheet needs (`DocumentListQueryDto`,
  `buildDocumentFilter`) and already bounds rows by the reader's `DOC_VIEW` scope
  (`DocumentService.visibleWhere`). Pending = `IN_APPROVAL` (33 rows today) plus `SUBMITTED`.
- `document.grand_total` is the populated per-document figure in the document's own currency
  (`total_amount` is null in practice); `currency` is null on the 360 imported spend-history rows.
- `document.doc_no` is `PR-HAL-2026-0004`; the sheet stamps `1034/ຈຊຈ/ບຫ`. Neither `ຈຊຈ` nor `ບຫ`
  is stored anywhere. `ຈຊຈ` does exist as a *department* (`ໜ່ວຍງານຈັດຊື້`, child of `ADM`), which
  is why the sheet groups it under `ພະແນກບໍລິຫານ`.
- The real form's text field is named `Reson` (sic) and holds HTML; the PDF's
  `PURPOSE_FIELD_NAMES` convention does not match it. Line descriptions are present on POs and
  empty on most disbursements.
- `bank_account` (the company's own accounts) has no rows, so K/L/M cannot be derived.
- `xlsx@0.18.5` is a backend dependency (plan / chart / spend importers read with it); nothing
  writes a workbook yet. The PDF path shows the download pattern (`StreamableFile` + `@Header`,
  `responseType: 'blob'` + `downloadBlob`).

## Goals / Non-Goals

**Goals:**
- One `DOC_VIEW`-gated endpoint that turns the filtered list into finance's sheet, byte-for-byte
  in the layout they hand around, with the default being the pending set.
- The paper-style number from configuration (`short_name` on type and department) with a code
  fallback, so the sheet is complete before anyone configures anything.
- Money as strings end to end; a JS number appears only inside the cell object handed to `xlsx`.
- Nothing written, nothing converted.

**Non-Goals:**
- Storing the head's ordering, the chosen paying account, or the finance number. Exported blank.
- Reading `bank_account` for the bank / main / reserve columns.
- A generic "any report to Excel" facility. This is one sheet with one layout; the CSV exports in
  `reporting` stay as they are.
- Changing `doc_no` itself or the numbering service.

## Decisions

### D1. Hang the export off the documents list, not off the ready-to-pay queue

The sheet is of *pending* documents — before full approval, when finance is preparing and the head
is prioritising — so its population is the list with `status IN (SUBMITTED, IN_APPROVAL)`, not
`owedDocuments()` (which is `COMPLETED` and unpaid). Reusing `DocumentListQueryDto`,
`buildDocumentFilter` and `visibleWhere` means the workbook can never disagree with the screen, and
`status=COMPLETED` gives the "approved, awaiting payment" sheet for free.

*Alternative:* a new report in `reporting` under `REPORT_VIEW`. Rejected — it would re-implement
the document filters and the reader scope, and a finance clerk who can see the list would need a
second permission to download what they can already see.

### D2. `short_name` on `document_type` and `department`, fallback to code

The two abbreviations are facts about *this* company's paper conventions (invariant 7). A map in
code would be per-company logic; deriving them from the Lao `name` is guesswork. Two nullable
columns, exposed on the existing admin forms, read at export time with `?? code`. Not unique: two
types may share a stamp.

*Alternative:* store the whole paper number on the document. Rejected — it would have to be
backfilled for every existing document and kept in step with two configurables; composing it at
render time from parts the system already holds needs neither.

### D3. Description: line descriptions first, form text second

`document_line.description` is the itemised answer when it exists (POs). Disbursement letters keep
their substance in one rich-text form field, whose *name* is not a convention the PDF knows
(`Reson`). So the fallback is structural, not name-based: the first `text`-typed `form_field` of the
document's template, in `sort_order`, stripped and cut to 200 characters. `stripHtml` moves from
`document-pdf.service.ts` to `back/src/common/text/strip-html.ts` so both callers share it.

### D4. Workbook building is a pure function

`buildPayablesWorkbook(rows: PayablesRow[], opts): Buffer` in
`back/src/modules/document/payables-workbook.ts` takes already-shaped rows (strings and dates) and
returns bytes. The service (`DocumentService.exportPayables(q)`) does the reads and shaping; the
builder does grouping, subtotals and cell layout. The builder is unit-tested by reading its output
back with `XLSX.read` and asserting cells — no database, no HTTP.

Grouping: walk `parent_dept_id` upward to the root once per distinct department (departments are
loaded in one query for the company; a cycle is already impossible per `multi-company`). Group
heading text: `<root.name> (<child names joined by ", ">)` when the group holds children, else just
the root's name.

Money: rows carry `grandTotal: string`; subtotals and totals are `Money.add` over strings; each
cell is emitted as `{ t: 'n', v: Number(str), z: <format from decimal_places> }` at the last step.
The number format is `#,##0` for 0 places, `#,##0.00` for 2, generalised from
`currency.decimal_places`. The `SUM` is written as values, not formulas, so the file is correct in
viewers that do not recalculate.

Currency columns: fixed order `LAK, THB, USD, CNY`, headed by the Lao names the sheet uses (a small
map keyed by code, with `currency.code` as the header for any other currency), then any other
currency present, alphabetically. Only currencies that occur in the rows *or* are in the fixed four
are emitted — the four are always present so the sheet looks the same week to week.

Dates: `submitted_at` as the classic numeric serial (days since 1899-12-30) with format
`dd/mm/yyyy`, so finance can sort and filter. Not SheetJS's `t: 'd'` ISO-string cell: Google Sheets
(where finance opened the first file) rendered that as an empty column.

### D5. Route and response

`GET /documents/export/payables.xlsx` on `DocumentController`, declared before the `:id` routes,
`@RequirePermissions(P.DOC_VIEW)`, `@Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')`,
returns a `StreamableFile` with `Content-Disposition: attachment; filename="payables-<code>-<date>.xlsx"`
set from the active company (as the PDF route does). The query is `DocumentListQueryDto`; the
pagination fields it inherits are ignored, and `status` is defaulted in the service when absent.

Frontend: `documentsApi.exportPayables(filters)` with `responseType: 'blob'`, reusing
`downloadBlob`; a `Button` (icon `pi pi-file-excel`) in the list's filter bar, `v-if` on `DOC_VIEW`,
loading-state while in flight, toast on failure.

### D6. Read-only by construction

The service uses the company-scoped EM (`forActiveCompany()`) for the document read and plain
`find`s for lines, field values, departments and currencies. No `flush`, no transaction, no
ledger. The concurrency rules in CLAUDE.md do not apply: nothing reserves budget or issues a number.

## Risks / Trade-offs

- [The whole filtered set in memory] → the sheet is tens to low hundreds of rows in practice; the
  reads are batched (`$in` over document ids) rather than per row, and the workbook is built once.
  If a company ever exports thousands of rows this is a streaming problem for a later change, not
  a correctness one.
- [`Number(str)` for the cell loses precision above 2^53] → money here is ≤ 15,2 (`grand_total`
  precision), far inside the safe range; the string is what is summed, the number is only what the
  cell displays.
- [A type or department without `short_name` prints its code] → intended; the fallback is stated in
  the spec so the sheet is never blank, and the admin list shows which ones still stamp their code.
- [A form with no `text` field, and no line descriptions] → description empty; the spec says so.
  Better a blank than a guess.
- [Lao header strings live in code] → they are the column titles of one company's sheet; the
  currency headers are the only company-flavoured ones and fall back to the code. If a second
  company needs different headers, they become i18n keys — cheap to change once the shape is proven.

## Migration Plan

1. DBML + one migration: `alter table document_type add column short_name varchar null;
   alter table department add column short_name varchar null;`. Additive, no backfill, no lock of
   consequence.
2. Deploy backend then frontend; the endpoint is additive and the forms tolerate a missing field.
3. Rollback: drop the two columns; nothing depends on them but the export's fallback.
4. After deploy, finance (or an admin) enters `short_name` for the ~15 types and ~20 departments
   from the paper stamps — optional, and the sheet works before they do.

## Open Questions

- None blocking. Whether the head's ordering and the paying account should later live in the system
  (a queue-priority feature) is explicitly deferred — see proposal, "Deliberately NOT in this change".

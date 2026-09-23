# payables-worksheet-export Specification

## Purpose
Finance's payables sheet (`ລາຍຈ່າຍຄ້າງໃໝ່`) — what has been asked for and not yet paid, grouped by
department, one column per currency — produced from the documents list as an `.xlsx` so the head
can decide what is paid first without anyone re-keying rows the system already holds. The columns
finance decides on stay blank for a person to fill.
## Requirements
### Requirement: The Documents List Exports As Finance's Payables Sheet

The system SHALL expose `GET /documents/export/payables.xlsx`, gated by `DOC_VIEW`, that returns an
Excel workbook (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, served as an
attachment) of the documents the caller may list, laid out as the payables sheet finance keeps by
hand. The endpoint SHALL accept exactly the filters of the document list (`status`,
`documentTypeId`, `departmentId`, `vendorId`, `createdFrom` / `createdTo`, `docNo`, `minAmount` /
`maxAmount`), validated by the same DTO, and SHALL apply the active-company scope and the caller's
`DOC_VIEW` data scope exactly as the list does, so the workbook never holds a row the list would not
show (invariant 1). Pagination SHALL NOT apply: the workbook holds every matching row.

When `status` is omitted the export SHALL default to the pending set, `SUBMITTED` and
`IN_APPROVAL` — the sheet finance builds is of what has been asked for and not yet paid — and a
caller who names a status SHALL get that status instead, so `COMPLETED` is one filter away rather
than a second endpoint.

The export SHALL be read-only: it SHALL NOT write `budget_txn`, `approval_log`, `document`, or any
other table (invariant 2), and it SHALL NOT compute any exchange-rate conversion (invariant 6).

#### Scenario: Default is the pending set

- **GIVEN** the active company has documents in `DRAFT`, `IN_APPROVAL`, `SUBMITTED` and `COMPLETED`
- **WHEN** a `DOC_VIEW` user requests the export with no `status`
- **THEN** the workbook lists only the `SUBMITTED` and `IN_APPROVAL` documents

#### Scenario: A named status replaces the default

- **WHEN** the export is requested with `status=COMPLETED`
- **THEN** the workbook lists only `COMPLETED` documents and no pending one

#### Scenario: The list's filters narrow the sheet

- **WHEN** the export is requested with `departmentId` and a `createdFrom` / `createdTo` range
- **THEN** only documents of that department created in that range are written, and the same
  request to the list endpoint returns the same set of document ids

#### Scenario: The reader's scope bounds the sheet

- **GIVEN** a caller whose `DOC_VIEW` grant is `DEPARTMENT` scope
- **WHEN** they request the export
- **THEN** the workbook holds only the documents the list shows them, and no document of another
  department they are not party to

#### Scenario: Company isolation holds

- **WHEN** the export is requested while company A is active
- **THEN** no document of company B is written, and a `departmentId` belonging to company B matches
  no rows

#### Scenario: The export writes nothing

- **WHEN** the export is requested
- **THEN** the row counts of `budget_txn`, `approval_log` and `document` are unchanged afterwards

### Requirement: The Sheet Has Finance's Columns In Finance's Order

The workbook SHALL have one sheet with a title row, a header row, and one data row per document, in
this column order: arrival date (`ວັນທີ່ເອກະສານມາ`), running index (`ລ/ດ`), finance number
(`ເລກທີ ການເງິນ`), department number (`ເລກທີພະແນກ`), description (`ລາຍການ`), section (`ພາກສ່ວນ`),
one amount column per currency (see below), bank (`ບັນຊີ`), main account (`ຫຼັກ`), reserve account
(`ສຳຮອງ`), remark (`ໝາຍເຫດ`). Headers SHALL be written in Lao as listed, since the sheet is the
Lao-language document finance already keeps and hands to the head.

The bank column (`ບັນຊີ`) SHALL carry the `vendor_bank_account.bank_code` of the payee account the
document names (`BCEL`, `LDB`), and SHALL be empty when the document names none — the requester
already chose the destination, so the system can answer this one. The columns finance decides —
finance number, main account, reserve account, remark — SHALL be written **empty**. The system
holds no decision for them and SHALL NOT guess one.

Per row:
- arrival date SHALL be `document.submitted_at` as a date cell (no time), the moment the document
  reached finance's queue;
- section SHALL be the document's `department.name`;
- the running index SHALL count from 1 within the sheet in the order written.

Rows SHALL be ordered by `submitted_at` descending within each group (newest first, as finance's
sheet is kept), with `doc_no` as the tie-break.

#### Scenario: Decision columns are blank

- **WHEN** the export is produced
- **THEN** every data row's finance-number, main, reserve and remark cells are empty

#### Scenario: The payee's bank is written

- **GIVEN** a document whose payee account is at `BCEL` and one that names no payee
- **WHEN** the export is produced
- **THEN** the first row's bank cell is `BCEL` and the second row's bank cell is empty

#### Scenario: Arrival date is the submit date

- **GIVEN** a document created on the 1st and submitted on the 3rd
- **WHEN** the export is produced
- **THEN** its arrival-date cell is the 3rd

### Requirement: The Department Number Is Written As Running/Type/Department

The department-number cell SHALL be `<running>/<type>/<department>` where `<running>` is the
running-number part of `document.doc_no` (the digits the numbering service appended, e.g. `0004` of
`PR-HAL-2026-0004`), `<type>` is `document_type.short_name` when set and `document_type.code`
otherwise, and `<department>` is `department.short_name` when set and `department.dept_code`
otherwise. The system SHALL NOT hardcode any abbreviation per company (invariant 7): the Lao
abbreviations finance stamps on paper (`ຈຊຈ`, `ບຫ`) are configuration on the type and the
department, and the code fallback is what makes an unconfigured company's sheet still complete.

#### Scenario: Configured abbreviations are used

- **GIVEN** document `PR-HAL-2026-0004` whose type has `short_name` `ຈຊຈ` and whose department has
  `short_name` `ບຫ`
- **WHEN** the export is produced
- **THEN** its department-number cell is `0004/ຈຊຈ/ບຫ`

#### Scenario: A missing abbreviation falls back to the code

- **GIVEN** the same document but neither the type nor the department has a `short_name`
- **WHEN** the export is produced
- **THEN** its department-number cell is `0004/PR/ADM`

### Requirement: The Description Is What The Document Says It Is For

The description cell SHALL be the document's `document_line.description` values, in line order,
joined with `; `, omitting empty ones. When no line carries a description, the cell SHALL fall
back to the document's first text-typed form value (`doc_field_value.field_value` of a `form_field`
whose `field_type` is `text`, in `form_field.sort_order`), with HTML markup and entities stripped,
whitespace collapsed, and cut to 200 characters. When neither exists the cell SHALL be empty.

#### Scenario: Line descriptions are joined

- **GIVEN** a document with two lines described `A` and `B`
- **WHEN** the export is produced
- **THEN** its description cell is `A; B`

#### Scenario: A letter-style document is summarised from its form

- **GIVEN** a document whose only line has no description and whose form text field holds
  `<p>ຂໍສະເໜີ&nbsp;ເບີກງົບ</p>`
- **WHEN** the export is produced
- **THEN** its description cell is `ຂໍສະເໜີ ເບີກງົບ`

### Requirement: One Amount Column Per Currency, Never Converted

The amount columns SHALL be one per currency, headed by the currency's Lao name where the company's
sheet has one (`ເງິນກີບ`, `ເງິນບາດ`, `ເງິນໂດລາ`, `ເງິນຢວນ`) and by the `currency.code` otherwise,
in a fixed order `LAK`, `THB`, `USD`, `CNY`, then any other currency present in the rows
alphabetically. A row's `document.grand_total` SHALL be written under the column of its
`document.currency`, and only there; a document with no `currency` SHALL be placed under the
company's base currency, since that is the currency its amount was stamped in. No amount SHALL be
converted (invariant 6) and no total SHALL add cells across currencies.

Amounts SHALL travel from the database to the workbook builder as decimal strings and SHALL be
written to the cell with the currency's `decimal_places`; the JS `number` the workbook library
requires for a numeric cell SHALL be produced at the last step from the string, never arithmetic'd.

#### Scenario: A THB document lands in the THB column

- **GIVEN** a document in `THB` with `grand_total` `1500.00`
- **WHEN** the export is produced
- **THEN** its `ເງິນບາດ` cell is 1500.00 and its `ເງິນກີບ`, `ເງິນໂດລາ` and `ເງິນຢວນ` cells are empty

#### Scenario: A document with no currency is base currency

- **GIVEN** a `LAK`-based company and a document whose `currency` is null
- **WHEN** the export is produced
- **THEN** its amount is written under `ເງິນກີບ`

### Requirement: Rows Are Grouped By Top-Level Department With Subtotals

Data rows SHALL be grouped under their document's **top-level** department — the root reached by
following `department.parent_dept_id` upward — with a group heading row naming that root
(`department.name`) and listing its descendants' names in parentheses, and a subtotal row per
group holding, per currency column, the sum of that group's cells. After the last group a grand
total row SHALL hold the per-currency sum of all data rows. Groups SHALL be ordered by the root's
`dept_code`. Subtotals and totals SHALL be summed as decimals from the strings, never from JS
numbers, and SHALL be written per currency column only.

#### Scenario: A sub-department's document counts under its root

- **GIVEN** department `ຈຊຈ` whose parent is `ADM`, and one `LAK` document of each
- **WHEN** the export is produced
- **THEN** both rows sit under one `ADM` group heading, and that group's `ເງິນກີບ` subtotal is the
  sum of the two

#### Scenario: Totals never cross currencies

- **GIVEN** one `LAK` document and one `USD` document in the same group
- **WHEN** the export is produced
- **THEN** the subtotal row has one figure under `ເງິນກີບ` and one under `ເງິນໂດລາ`, and no cell
  adds them


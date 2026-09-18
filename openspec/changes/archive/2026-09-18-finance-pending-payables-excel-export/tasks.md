## 1. Data model — the two abbreviations

- [x] 1.1 Add `short_name varchar` to `document_type` and to `department` in
      `erp_approval_system.dbml`, each noted as the abbreviation stamped in a paper document number,
      optional, not unique, fallback to `code` / `dept_code`
- [x] 1.2 Add `shortName?: string` to the `DocumentType` entity (`document.entities.ts`) and the
      `Department` entity (`multi-company.entities.ts`)
- [x] 1.3 Write `Migration20260918000000.ts`: two nullable columns, no backfill; `down` drops them
- [x] 1.4 Accept `shortName` (optional, trimmed, max 20) on the document-type create/update DTOs and
      on `department.dto.ts`; return it from both read surfaces
- [x] 1.5 Extend `documentTypeSchema` and `departmentSchema` in `shared/src/index.ts` with
      `shortName: z.string().trim().max(20).nullish()`
- [x] 1.6 Unit tests: a type and a department store and read back `shortName`; an unset one reads
      null; a 21-character value is refused

## 2. Backend — the worksheet

- [x] 2.1 Move `stripHtml` from `document-pdf.service.ts` to `back/src/common/text/strip-html.ts`
      and import it back in the PDF service (no behaviour change; existing PDF tests still pass)
- [x] 2.2 Create `back/src/modules/document/payables-workbook.ts`: `PayablesRow` type (strings +
      a `Date`), `buildPayablesWorkbook(rows, { baseCurrency, currencies }) : Buffer` — title row,
      Lao header row, grouping by top-level department with heading and subtotal rows, grand total,
      fixed `LAK/THB/USD/CNY` then other currencies, date cells, number format from
      `decimal_places`, blank decision columns; sums via `Money.add` over strings, `Number()` only
      inside the cell object
- [x] 2.3 Add `DocumentService.exportPayables(q: DocumentListQueryDto)`: default `status` to
      `[SUBMITTED, IN_APPROVAL]` when absent; `buildDocumentFilter` + `visibleWhere` on the
      company-scoped EM with no pagination; batch-load lines, text-typed field values (with their
      `form_field.sort_order` and `field_type`), departments (whole company, for the root walk) and
      currencies; shape rows: `submittedAt`, `runningNo` from `doc_no`'s trailing digits,
      `typeAbbrev = type.shortName ?? type.code`, `deptAbbrev = dept.shortName ?? dept.deptCode`,
      description per D3, `currencyCode = document.currency?.code ?? company.baseCurrency.code`,
      `grandTotal`; order by `submittedAt` desc, `docNo`
- [x] 2.4 Add `GET /documents/export/payables.xlsx` to `DocumentController` ahead of the `:id`
      routes: `@RequirePermissions(P.DOC_VIEW)`, xlsx content type, `StreamableFile` with
      `Content-Disposition: attachment; filename="payables-<company code>-<yyyy-mm-dd>.xlsx"`
- [x] 2.5 Unit tests for the builder (read the buffer back with `XLSX.read`): header order and Lao
      titles; decision columns blank; `0004/ຈຊຈ/ບຫ` and the `0004/PR/ADM` fallback; `A; B` line
      join and the stripped-HTML fallback; THB lands only in the THB column; null currency lands in
      base; a child department's row sits under its root with the group subtotal; subtotal and grand
      total never add across currencies; date cell holds the submit date without time
- [x] 2.6 Service/endpoint tests against the DB: default is `SUBMITTED` + `IN_APPROVAL` only;
      `status=COMPLETED` replaces it; `departmentId` + date range yields the same ids as `list`;
      a `DEPARTMENT`-scope reader gets only what `list` shows them; company B's documents and a
      company-B `departmentId` yield nothing; `budget_txn` / `approval_log` / `document` counts are
      unchanged after an export; a caller without `DOC_VIEW` is refused

## 3. Frontend — admin forms

- [x] 3.1 `DocTypeFormView.vue`: optional short-name `InputText` bound to `shortName`, `FormField`
      error message from the shared schema; `DocTypesView.vue` shows it beside the code
- [x] 3.2 `DepartmentsView.vue` / `orgForm.ts`: the same field on the department create/edit form;
      the hierarchy list shows it beside the code
- [x] 3.3 i18n keys (label + hint "stamped in the paper document number") in `en`, `la`, `zh`
- [x] 3.4 Component tests: the field round-trips through both forms and an empty value is sent as
      null

## 4. Frontend — the export button

- [x] 4.1 `documentsApi.exportPayables(filters)` in `front-end/src/api/documents.ts`:
      `GET /documents/export/payables.xlsx` with the list's filter params and no page params,
      `responseType: 'blob'`
- [x] 4.2 `MyDocumentsView.vue` filter bar: an Export-to-Excel `Button` (`pi pi-file-excel`),
      shown under `DOC_VIEW`, loading state while in flight, `downloadBlob` with
      `payables-<company code>-<yyyy-mm-dd>.xlsx`, toast on failure; tooltip says an empty status
      filter exports the pending set
- [x] 4.3 i18n keys for label, tooltip and the failure toast in `en`, `la`, `zh`
- [x] 4.4 Component tests: the button sends the current filters and no `page` / `limit`; no status
      selected sends no `status`; a failed request shows the toast and re-enables the button;
      the button is absent without `DOC_VIEW`

## 5. Verification

- [x] 5.1 Run the full backend and frontend suites (`nvm use 22.19.0`, `DB_NAME=erp_test`)
- [x] 5.2 Export from the local restore (`epr-prodution-test`) with no filters, open the file, and
      check against `~/Downloads/111.xlsx`: same column order, pending rows only, grouped under
      their root department, four currency columns, blank decision columns
- [x] 5.3 Set `short_name` on one type and one department in the local restore and confirm the
      department-number cell switches from the code to the abbreviation

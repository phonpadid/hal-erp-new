## 1. Guard the catalogs before repairing them

- [x] 1.1 Add `front-end/src/i18n/catalog-script.spec.ts`: walk every `la` value and fail on a
      codepoint in U+0E00–U+0E7F; walk every `en` value and fail on U+0E00–U+0E7F or U+0E80–U+0EFF.
      Report the key path and the offending character. Confirm it fails on the four known values
      before any of them are fixed.
- [x] 1.2 Give the guard the same inline marker escape hatch `no-literal-text.spec.ts` uses, and
      cover it with a test that a marked value passes.
- [x] 1.3 Add a guard case for bare foreign acronyms in `la`: fail on a standalone run of two or
      more ASCII capitals that is not marked non-translatable. Confirm it fails on the 11 known
      `WHT` / `SLA` values.

## 2. Repair the catalog values

- [x] 2.1 Rewrite the Thai-script values in Lao: `la/nav.ts:64` `withholdingTax`, `la/gl.ts:106`
      `wht.title`, `la/gl.ts:113` `wht.remitExplain`, `la/documents.ts:89` `missingRequired`.
      Wording confirmed with a Lao-speaking accountant (design Open Question 1).
- [x] 2.2 Replace `WHT` with the agreed Lao term in `la/tax.ts:12`, `la/payments.ts:106-108`,
      `la/admin.ts:498`; use one term across all six, not two as today.
- [x] 2.3 Replace `SLA` with the agreed Lao term in `la/approvals.ts:10`, `la/reports.ts:47`,
      `la/admin.ts:429`, `:432`, `:434`, `la/documents.ts:210`.
- [x] 2.4 Update the matching `en` keys so `i18n.parity.spec.ts` still passes, and run guards 1.1
      and 1.3 to green.

## 3. Show the configured name, not the code

- [x] 3.1 Add `categoryName` to the document-summary report row: join `document_category` on
      (`company_id`, `code`) in the reports query, alongside the `typeName` the row already carries.
      Read-only; no catalog key is added, because a category code is per-company configuration.
- [x] 3.2 Extend `DocumentSummaryRow` in `api/reports.ts` with `categoryName`.
- [x] 3.3 `DocumentSummaryReport.vue:101-103` — build the chart's `labels` from `typeName` so the
      chart matches the table in the same view.
- [x] 3.4 `DocumentSummaryReport.vue:232` — render `categoryName` instead of `field="category"`.
- [x] 3.5 Test: render the report with one type and assert the chart label and the table cell show
      the same name, and that neither shows `BUDGET_PLAN` or `FINANCE`.

## 4. Backend — a document-type read for readers

- [x] 4.1 Resolve design Open Question 3 (types present in the caller's rows vs every type in the
      company) before writing the query.
- [x] 4.2 Add `GET /documents/types` to `document.controller.ts` with
      `@RequirePermissions(P.DOC_VIEW)`, returning distinct `document_type` rows referenced by
      `document` rows under the same company and scope predicate the list endpoint applies.
      Read-only: no `em.transactional()`, no lock, no ledger write.
- [x] 4.3 Test: a `DOC_VIEW` user holding no `DOC_CREATE` gets a non-empty list for a company whose
      documents span several types.
- [x] 4.4 Test: the result never includes a type that only appears on documents outside the
      caller's scope.
- [x] 4.5 Leave `GET /documents/creatable-types` untouched — the create wizard is its caller.

## 5. Option lists that state their own condition

- [x] 5.1 In `stores/documents.ts`, replace the `types` array with a discriminated state
      (`idle` / `loading` / `loaded` / `failed`) and drop `.catch(() => [])` at line 77.
- [x] 5.2 Point the documents type filter at `GET /documents/types` and change its gate in
      `MyDocumentsView.vue` from `auth.can('DOC_CREATE')` to `auth.can('DOC_VIEW')`.
- [x] 5.3 Give both the type and vendor Selects in `MyDocumentsView.vue:288` and `:320` an explicit
      translated `emptyMessage` for the loaded-and-empty case and an error affordance for the
      failed case, so PrimeVue's `No available options` is never reached.
- [x] 5.4 Apply the same state shape to the vendor list in `stores/masterData.ts`.
- [x] 5.5 Test: with the types read stubbed to reject, the filter shows the failure text and not
      the empty text; with it stubbed to resolve empty, it shows the empty text.
- [x] 5.6 Inventory the remaining swallow sites for follow-up without changing them here:
      `stores/documents.ts` (4 left), `stores/org.ts` (5), `stores/docConfig.ts` (2),
      `stores/approvalConfig.ts` (2). Record them in the change's notes, not in code comments.

## 6. Tables and empty states at 375px

- [x] 6.1 Add a per-column priority to `AppDataTable.vue`, defaulting to primary so untouched views
      keep today's behaviour.
- [x] 6.2 Below the `md` breakpoint, hide secondary columns and add a row expander that renders
      them as a label/value list.
- [x] 6.3 Declare priorities on the documents list columns; confirm the primary set with the
      accountant (design Open Question 2).
- [x] 6.4 Move the empty state out of the table's `#empty` slot so it renders as a sibling of the
      scroll container rather than inside it.
- [x] 6.5 Test at 375px: every documents-list column is reachable, and the empty state's title and
      message are within the viewport with no horizontal scroll.
- [x] 6.6 Test at 375px: the empty state is not covered by the global floating affordance.

## 7. Failures that show

- [x] 7.1 Add a flag to the document detail response stating whether the document has payment
      evidence to read. Read-only addition; no write path involved.
- [x] 7.2 Gate the slips panel in `DocumentDetailView.vue:182-190` on that flag and remove the
      `@absent` teardown.
- [x] 7.3 In `PaymentSlips.vue:42`, stop catching every error into `absent`; a failed slips read
      renders an error state in the panel.
- [x] 7.4 Test: opening a document with no payment handoff issues no request to
      `/payments/{id}/slips`.
- [x] 7.5 Test: a slips read that fails with a server error shows an error state rather than
      hiding the panel.
- [x] 7.6 Split `SpendByVendorReport.vue:78` into four explicit branches — loading, error, empty,
      data — so the chart no longer mounts while the request is in flight.
- [x] 7.7 Give `SpendByVendorReport.vue:78` and `:85` the `message` that `EmptyState` requires
      alongside `title`.
- [x] 7.8 Show a chart initialisation failure as an error state in the chart's own region.
- [x] 7.9 Test: mounting the vendor-spend report with a pending request renders the loading state
      and does not mount the chart; the console stays clean.

## 8. Verify against the review

- [x] 8.1 Run the web suite: guards from group 1, `i18n.parity.spec.ts`, `no-literal-text.spec.ts`,
      and the per-view smoke tests all green, exit zero, no unhandled rejection.
- [x] 8.2 `vue-tsc -b` clean.
- [x] 8.3 Re-walk the five findings as the accounting user at 1440px and 375px, comparing against
      the screenshots in `docs/ux-review/`, and record the result in the change notes.

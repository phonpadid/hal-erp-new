## Why

A UX review run as a new accounting user (`docs/ux-review-accounting.md`, 2026-08-25) found five
places where a screen leaves the reader with no way to know what happened. Two dropdowns render
`No available options` in a Lao UI while the table behind them plainly shows matching rows; the Lao
catalog carries Thai glyphs and bare English acronyms; at 375px the documents table shows two of its
eight columns and pushes its own empty state off-screen under a floating button; and two failed
requests are discarded without a trace on screen.

None of these are new capabilities. Each one violates a requirement `web-i18n`, `web-ui-quality`, or
`web-documents` already states — the requirements are simply not enforced anywhere, so regressions
land unnoticed. The fix is to make each rule checkable and then repair the instances found.

## What Changes

**The Lao catalog stops carrying text that is not Lao.**
- Four catalog values splice Thai script into Lao words: `nav.withholdingTax`, `gl.wht.title` and
  `gl.wht.remitExplain` (all `ພາສີຫັກ ณ ທີ່ຈ່າຍ`, with the Thai letter `ณ`), and
  `documents.missingRequired` (`ຍັງບໍ່ໄດ້ກรอก`, Thai `รอก` spliced inside a Lao word). Each is
  rewritten in Lao script; the exact wording is a translation decision for a Lao reader, not a
  mechanical transliteration.
- A new catalog guard spec fails the build on any Thai codepoint in a `la` value, joining the
  existing `i18n.parity.spec.ts` and `no-literal-text.spec.ts`.

**Bare English tokens in the Lao UI get Lao words.**
- `WHT` appears in six catalog values while the nav names the same tax in Lao; `SLA` appears in
  five, including two bare column headers. Each gets one Lao term, used everywhere.
- Server enum values (`BUDGET_PLAN`, `FINANCE`) reach the eye raw on the documents report — as a
  chart axis label and a category column — while the table below them in the same view shows the
  translated name. Enum-to-label resolution becomes the only path to display.

**An empty option list says why it is empty.**
- The documents type filter is populated from `documentsApi.creatableTypes()` — the types this user
  may *create*. A reviewer filtering documents someone else raised needs the types *present in the
  list*, which is a different question with a different answer. The filter is re-sourced
  accordingly. **BREAKING** for `web-documents`: the stated gate `DOC_CREATE` for the type filter no
  longer describes the right permission.
- `stores/documents.ts` turns a failed types read into `[]` with `.catch(() => [])`; 13 other
  swallow sites exist across `stores/`. A list that is empty because its read failed SHALL be
  distinguishable on screen from a list that is genuinely empty.

**A table narrower than its columns stays usable.**
- `AppDataTable` sets `scrollable` and nothing else, so at 375px the documents list surrenders
  status, amount, date, and next approver to horizontal scroll with no affordance that they exist.
- `EmptyState` centres on its container; inside a scrollable table wider than the viewport that
  container is the table, so the message lands off-screen and behind the global floating button.

**A discarded request failure becomes visible.**
- Opening any document detail issues `GET /payments/{id}/slips`; for a document with no payment
  handoff the server answers 404 and the view shows nothing about it.
- The vendor-spend report raises `Failed to create chart: can't acquire context` and renders an
  empty card in its place.

## Capabilities

### New Capabilities

None. Every rule this change adds belongs to a capability that already exists.

### Modified Capabilities

- `web-i18n`: adds a requirement that a locale's catalog values are written in that locale's script
  and carry no untranslated foreign-language token, enforced by a guard spec rather than by review.
- `web-ui-quality`: adds requirements that (a) a control whose option list failed to load says so
  instead of reading as empty, (b) a data table whose columns exceed the viewport keeps every column
  reachable and its empty state on-screen, and (c) a failed request is never discarded into a silent
  default. Extends the existing floating-affordance requirement to cover a screen's empty state, not
  only its primary action.
- `web-documents`: changes the Document List Filtering requirement — the type filter's option list
  and its permission gate. The current text names `DOC_CREATE` and a creatable-types source, which
  answers the wrong question for a reader filtering other people's documents.

## Impact

**Build-order capabilities touched:** none of the nine domain capabilities change behaviour. This is
presentation over `document-engine` (list filtering, detail view) and `rbac` (which permission gates
a filter). No ledger, budget, quota, numbering, or FX path is touched.

**Invariants:** no `budget_txn` or `approval_log` write is involved, so append-only and the balance
formula are untouched. The one invariant in range is money-as-string: table and empty-state work
must not coerce an amount to a JavaScript number in order to lay it out.

**Code**
- `front-end/src/i18n/locales/la/*` — `nav.ts`, `gl.ts`, `documents.ts`, `tax.ts`, `payments.ts`,
  `admin.ts`, `approvals.ts`, `reports.ts`; matching `en` keys stay parity-complete.
- `front-end/src/i18n/` — new catalog guard spec alongside `i18n.parity.spec.ts`.
- `front-end/src/components/AppDataTable.vue`, `EmptyState.vue`.
- `front-end/src/views/documents/MyDocumentsView.vue`, `DocumentDetailView.vue`.
- `front-end/src/views/reports/` — documents report (enum labels, chart), vendor-spend report.
- `front-end/src/stores/` — 14 `.catch(() => [])`-style sites; `documents.ts` `loadTypes` first.
- `front-end/src/api/documents.ts` — a list-facing types source if the server has none.

**API:** may need a documents-list facet, or an unfiltered document-type read gated by `DOC_VIEW`
rather than `DOC_CREATE`. Decided in design.

**Not in scope:** the other findings in the review — missing approval history on completed
documents, absent period-close permissions, the empty tax-code table, payables columns. Those are
behaviour and data gaps rather than screens failing quietly, and each needs its own proposal.

# Implementation notes

## Swallowed reads still outstanding (task 5.6)

`stores/documents.ts:77` — the type filter's `.catch(() => [])` — is fixed by this change, and the
shape to replace the rest with is `stores/loadState.ts` (`OptionList` + `loadOptions`). Thirteen
sites remain. They are listed here rather than left as code comments so that the list is countable
and one place goes stale rather than thirteen.

**Option lists behind a control** — the same failure mode as the one repaired here: a failed read
becomes an empty dropdown, and the user reads it as a fact about the data.

| Site | Read |
|---|---|
| `stores/approvalConfig.ts:55` | `approvalConfigApi.users()` |
| `stores/approvalConfig.ts:56` | `approvalConfigApi.documentTypes()` |
| `stores/docConfig.ts:54` | `docConfigApi.departments()`, `docConfigApi.roles()` |
| `stores/docConfig.ts:55` | `docConfigApi.users()`, `jobLevelsApi.selectable()` |
| `stores/org.ts:121` | `orgApi.currencies()` |

**Whole list reads** — `.catch(() => null)` on a paginated read, so a failed page is
indistinguishable from an empty one. These want the view's error state rather than an option-list
state, so they are a different repair from the table above.

| Site | Read |
|---|---|
| `stores/org.ts:116` | `orgApi.companies.list()` |
| `stores/org.ts:118` | `orgApi.departments.list()` |
| `stores/org.ts:119` | `orgApi.fiscalYears.list()` |
| `stores/org.ts:120` | `orgApi.holidays.list()` |

**Detail-panel reads** — arguably correct as they stand, since each is an optional section of a
document detail, but each shares the flaw repaired in `PaymentSlips` (group 7): a server error is
read as "this document has none".

| Site | Read |
|---|---|
| `stores/documents.ts:92`, `:130` | `documentsApi.approvalLog(id)` |
| `stores/documents.ts:134` | `documentsApi.sla(id)` |
| `stores/documents.ts:138` | `documentsApi.matching(id)` |

`documents.ts:92` and `:130` are worth taking first. An approval log that fails to load renders as
"ຍັງບໍ່ມີການອະນຸມັດ" — no approvals yet — which is the sentence the UX review found under a
document marked ສຳເລັດ, and the reason it could not be told apart from a genuinely absent trail.

## A trap in `mountView` worth knowing

`src/test/mountView.ts` spreads `initialState` over its own `auth` defaults, so a spec that passes
both `permissions: [...]` and `initialState.auth` loses the permissions — every `can()` then reads
false and permission-gated markup silently does not render. Two specs written during this change
hit it. A spec overriding `auth` has to carry `permissions` through.

## Verification against the review (task 8.3)

Re-walked as `anousone` at 1440px and 375px, against `docs/ux-review/p3-*.png`.

| Finding | Before | After |
|---|---|---|
| Thai `ณ` | `ພາສີຫັກ ณ ທີ່ຈ່າຍ` in nav and page title | `ອາກອນຫັກ ຢູ່ທີ່ຕົ້ນທາງ` — [after-01](../../../docs/ux-review/after-01-wht-1440.png) |
| `No available options` | both filters, over 20 rows | type filter offers `ແຜນງົບປະມານ` — [after-03](../../../docs/ux-review/after-03-type-filter-populated.png) |
| Raw enum in a chart | axis read `BUDGET_PLAN` | axis reads `ແຜນງົບປະມານ`, matching the table — [after-04](../../../docs/ux-review/after-04-report-documents-1440.png) |
| 375px table | 2 of 8 columns, no sign of the rest | 3 primary columns fit; 4 fold into a row expander with their labels — [after-11](../../../docs/ux-review/after-11-documents-375.png), [after-12](../../../docs/ux-review/after-12-row-expanded-375.png) |
| 375px empty state | clipped at the right edge, under the floating button | fully legible inside the viewport — [after-15](../../../docs/ux-review/after-15-payables-375.png) |
| 404 on `/payments/{id}/slips` | fired on opening any document | not issued; gated on `hasPayment` from the detail response |
| chart init error | console only, blank card | four explicit branches; no chart mounts while loading |

### Two things verification turned up that the code cannot fix

**`FINANCE` still shows in the ໝວດ column, and this is a data fault.** `document_type.BUDGET_PLAN`
carries `category = 'FINANCE'`, but `document_category` holds only `PO`, `PR`, `RCRIPT` — there is
no `FINANCE` row in this company. `document_type.category` is a soft code-ref (DBML line 677), so
nothing enforced it. The new `categoryName` falls back to the code, which is the honest reading:
the category has a code and no name. Creating the missing category is a customer configuration
decision, not a code change, so it is left alone.

**The amount column's header is clipped at 375px.** `ຍອດລວມສະກຸນຫຼັກ` is a single Lao token with no
break opportunity in a ~75px column. Its *value* is visible, which is what a reader triages on.
Breaking Lao between characters was tried and is worse — it sets the header one letter per line.

## Deviations from the design, and why

- **Decision 6** proposed moving the empty state out of the table's `#empty` slot. Implemented as
  sticky positioning instead: 59 views pass that slot, and moving it would also take the header row
  and paginator away from an empty view. Recorded in `design.md`.
- The empty-state rule ended up in `src/style.css`, not in `AppDataTable`. Verification found the
  payables screen unfixed because it mounts a bare `DataTable` — 33 views do.
- **Decision 5** assumed a single `data-priority` per column would do. It needed a second value,
  `identity`, for the column that carries the row's name: under the fixed layout that lets three
  columns share 375px, an equal share is too little for a document number and stacks it.

## Context

Five findings from `docs/ux-review-accounting.md` share one shape: the screen holds information the
reader needs and does not deliver it. Investigating each one down to its line showed that none is a
one-off typo — each is a pattern with more instances than the review found.

What the code says today:

| Finding | Where it actually lives | What the review missed |
|---|---|---|
| Thai `ณ` in a Lao string | `la/nav.ts:64`, `la/gl.ts:106`, `la/gl.ts:113` | a fourth: `la/documents.ts:89` splices Thai `รอก` **inside** the Lao word `ກ…ອກ` |
| `WHT` / `SLA` raw | 6 `WHT` values, 5 `SLA` values across 6 catalog files | `la/approvals.ts:10` and `la/reports.ts:47` are bare column headers — the term is the whole cell |
| `No available options` | `MyDocumentsView.vue:288` and `:320` | the filters are **not** ungated — `canType`/`canVendor` both passed. The lists were empty because `stores/documents.ts:77` does `.catch(() => [])`, and because `creatable-types` answers a different question |
| 375px table | `AppDataTable.vue:71` sets `scrollable` and nothing else | `EmptyState` centres on its container, so a wide table pushes its own empty state off-screen |
| two silent errors | `PaymentSlips.vue:42`, `SpendByVendorReport.vue:78` | both are deliberate: the 404 is a probe, and the chart error comes from a two-branch `v-if`/`v-else` that renders the data branch while loading |

Two existing requirements are already violated by code found on the way: `web-ui-quality`'s
"Empty state shows a title and message" (`SpendByVendorReport.vue:78` and `:85` pass `title` only)
and "Loading state while fetching" (same file renders the chart during load).

Constraints: Vue 3 + PrimeVue 4 + Tailwind are fixed. `la` is the default locale and `en` the
fallback; catalogs must stay key-complete (`i18n.parity.spec.ts` enforces it). Money stays a string.

## Goals / Non-Goals

**Goals:**
- Make each rule the change adds enforceable by a test, so the instances stay fixed.
- Repair every instance of each pattern that exists today, not only the ones the review saw.
- Give the documents type filter an option list that answers the reader's question.
- Establish one three-state (loading / empty / error) shape for data regions and apply it where the
  swallowed failures were found.

**Non-Goals:**
- Redesigning the documents list, the payables columns, or any report's content. Column *sets* are a
  separate proposal; this change is about columns that exist being reachable.
- Rewriting all 14 `.catch(() => [])` sites. The pattern and the documents instances land here; the
  remaining sites are inventoried in tasks and follow behind a guard.
- Translating anything beyond the terms named. A general Lao copy review is its own piece of work.
- Any backend behaviour change beyond the two reads named in Decisions 3 and 6.

**No budget or quota path is touched.** This change writes no `budget_txn` and no `quota_usage`
row, opens no `em.transactional()` boundary, and takes no `PESSIMISTIC_WRITE` lock. The one new
backend read (Decision 3) is a `SELECT DISTINCT` over `document` rows the caller may already read.

## Decisions

### 1. The catalog script guard checks codepoints, not words

A guard spec beside `i18n.parity.spec.ts` walks every `la` catalog value and fails on any codepoint
in U+0E00–U+0E7F (Thai), and every `en` value and fails on Lao or Thai. It reports key path and
offending character.

The escape hatch matches the one `no-literal-text.spec.ts` already uses: a marker comment on the
same line. Reusing the existing convention means one thing to learn, not two.

*Alternative — a spellcheck or translation-memory pass:* catches more, but needs a Lao dictionary
and a human in the loop, so it cannot gate a build. The codepoint check catches the class of bug
that actually shipped (a glyph that looks right and is not) at zero maintenance cost.

*Alternative — review discipline:* four instances shipped past review, one of them inside a word.
Lao and Thai are too close to read apart reliably.

### 2. A chart shows the name the table shows

`DocumentSummaryReport.vue` renders the type correctly in its table (`field="typeName"`, line 227)
and incorrectly in its chart (`labels: types` built from `typeCode`, line 103) — in the same file.
The row already carries `typeName`; the chart simply reaches for the wrong field.

Category is the harder half. `DocumentSummaryRow` carries `category` — a code — and no name, so
`field="category"` renders `FINANCE` because there is nothing else to render. The DBML is explicit
that `document_category` is per-company configuration replacing the old `doc_category` enum, with
its own `name` (line 660-665), and that `document_type.category` is a soft code-ref to it. So the
row gains `categoryName` from that record, resolved server-side where the join already lives.

*Alternative — catalog entries keyed by code (`documents.categories.FINANCE`):* what this design
first proposed, and wrong. A category code is invented per company, so a shipped catalog can never
be complete, and hardcoding customer configuration in the front end contradicts configuration over
code. It would also render a company's own chosen name unreachable.

*Alternative — resolve the code client-side against a categories read:* possible, but it adds a
request and a cache to every view showing a category, to avoid one join the report query is already
positioned to make.

### 3. A new `DOC_VIEW` read returns the types present in the list

`GET /documents/creatable-types` is `@RequirePermissions(P.DOC_CREATE)`
(`document.controller.ts:110`) and returns the types the caller may author. A reviewer filtering
other people's documents needs the types **occurring in the list they can see**. There is no
endpoint for that today.

Add `GET /documents/types`, `@RequirePermissions(P.DOC_VIEW)`, returning the distinct
`document_type` rows referenced by `document` rows within the caller's company and permission scope
— the same scope predicate the list endpoint applies, so it discloses nothing the list does not.

*Alternative — relax `creatable-types` to `DOC_VIEW`:* one line, but it hands a reviewer a list of
types they cannot author and omits types present in the list they can see. It answers the wrong
question more permissively.

*Alternative — derive the option list client-side from the loaded page:* no backend work, but the
filter would offer only the types on page 1 while filtering the full dataset — a filter that hides
the rows it is supposed to find.

The `web-documents` gate moves from `DOC_CREATE` to `DOC_VIEW` accordingly. Department and vendor
filters keep their gates; only the type filter was gated on an authoring permission.

### 4. An option-backed control carries a status, not just an array

Replace `types: CreatableType[]` with a small discriminated state — `idle` / `loading` / `loaded` /
`failed` — and let the control render from it. `.catch(() => [])` at `stores/documents.ts:77` is
what turned a failed read into a sentence about the data.

The Select receives an explicit `emptyMessage` when the list loaded and is genuinely empty, and an
error affordance when the read failed. PrimeVue's default string is never what the user sees, which
also removes the untranslated `No available options` at its source rather than by translating it.

Applied here to the documents type and vendor filters. The other 12 sites are listed in tasks with
the same shape.

### 5. Columns get a priority; low-priority columns fold into a row expander

`AppDataTable` declares `scrollable` and leaves the rest to the browser. Instead, each column
declares whether it is primary (identity and the fields a reader triages on) or secondary. Below
the `md` breakpoint secondary columns are hidden via Tailwind and a row expander reveals them as a
label/value list.

*Alternative — PrimeVue's stacked responsive layout:* turns every row into a block, which reads
well for three columns and badly for eight, and loses column alignment for scanning.

*Alternative — leave horizontal scroll and add a scroll hint:* cheapest, but the reader still cannot
compare two rows on a field that is off-screen, which is what triage is.

Declaring priority once per column keeps a single source of truth: the same declaration drives the
desktop table and the mobile expander.

### 6. The empty state pins to the visible area, not to the table's width

`EmptyState` is `items-center justify-center` on its own wrapper (`EmptyState.vue:24`). Inside a
horizontally scrollable table the wrapper's width is the table's natural width, so "centre" is
off-screen. The fix is positional, not cosmetic.

*Implemented differently from what this design first proposed.* Moving the empty state out of the
table's `#empty` slot and rendering it as a sibling of the scroll container would touch all 59
views that pass that slot, and would take the header row and paginator away from the empty view.
Instead `AppDataTable` pins the empty cell's content with `position: sticky; inset-inline-start: 0`
so it tracks the visible area while the table scrolls under it — same user-visible outcome, one
file, no caller changes.

The same rule ends the overlap with the global floating affordance: the message is pinned to the
left of the viewport and carries `padding-inline-end` clear of the affordance's corner.

### 7. The detail response says whether a payment exists; the client stops probing

`PaymentSlips.vue:42` catches **every** error and emits `absent`, so a 500 or a dropped connection
reads as "this document was never paid" and the panel disappears. The comment at
`DocumentDetailView.vue:180` is candid about why: *"nothing here knows the type's post_action."*

Give the detail response that knowledge — a flag stating whether the document has payment evidence
to read — and gate the panel on it. The probe request disappears, so the 404 disappears with it, and
a genuine failure of the slips read can then be shown as a failure.

*Alternative — narrow the catch to 404 only:* removes the misreading of a 500, but keeps a request
that is expected to fail as normal operation, which trains everyone reading the network tab to
ignore 404s from this app.

### 8. A data region has three branches, not two

`SpendByVendorReport.vue:78` reads `v-if="!reports.loading && !hasData"` with a bare `v-else`. While
the request is in flight both `loading` and `!hasData` are true, so the `v-if` is false and the
`v-else` branch mounts — the chart initialises against a canvas that is about to be torn down, which
is exactly `can't acquire context`. The chart error is a symptom; the collapsed condition is the
bug, and it is also why the view renders a chart as if the request had completed.

Loading, empty, error, and data become four explicit branches in the views touched here. The
existing `web-ui-quality` loading/empty/error requirement already demands this; it was simply not
met in this file.

## Risks / Trade-offs

**A Lao term for WHT or SLA that the customer's accountants do not use is worse than the acronym.**
→ The terms are proposed, not imposed: tasks land the mechanism and a candidate term, and the
strings are confirmed with a Lao-speaking accountant at HAL before the change archives. `WHT`
already appears in two different forms (`ຈຳນວນ WHT`, `ອາກອນ WHT`) so some term choice is
unavoidable regardless.

**Moving the type filter to `DOC_VIEW` widens who can enumerate document types.** → The new read
returns only types already referenced by rows the caller can list, under the same scope predicate.
A caller learns nothing they could not learn by paging the list.

**Column priority touches every list view.** → The default is "primary", so a view that declares
nothing behaves as it does today; only views given a priority change. Rolling it out list by list is
therefore safe, and this change applies it to the documents list only.

**Rendering the empty state outside the scroll container changes DOM structure in shared table
markup.** → `AppDataTable` is the single wrapper; the change is made there and the existing
per-view smoke tests cover the mount.

**Four explicit branches is more markup than two.** → It is the shape the quality spec already
requires, and the two-branch version is what produced a console error in production data.

## Migration Plan

No data migration and no schema change. The one backend addition is a new read endpoint; nothing
existing changes signature. `GET /documents/creatable-types` stays as it is — the create wizard is
its correct caller.

Deployment is ordinary: backend first so the new types read exists, then the web build. The web
change degrades safely if deployed first — the type filter's read fails, and by Decision 4 that
now renders as a failure the reader can see rather than as an empty list.

Rollback is per-decision; nothing here is coupled to anything else except that Decision 3 must ship
before or with the filter re-sourcing.

## Open Questions

All three are resolved (2026-08-25, decided with the change's requester):

- **The Lao terms.** Withholding tax is `ອາກອນຫັກ ຢູ່ທີ່ຕົ້ນທາງ` — the catalog's two competing
  stems (`ພາສີ` in nav/gl, `ອາກອນ` in payments) collapse onto `ອາກອນ`. An approval deadline is
  `ກຳນົດເວລາ`, which sits with the `ກຳນົດ` / `ເກີນກຳນົດ` pair already in `la/approvals.ts`.
- **Primary columns at 375px.** Document number, status, amount. Date, next approver, transfer slip
  and the action column fold into the row expander.
- **`GET /documents/types` scope.** Only the types occurring in the rows the caller can see. The
  filter list narrows as other filters narrow; that is accepted in exchange for disclosing nothing
  beyond the list itself.

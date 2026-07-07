## Context

The app has a shared list-page kit: `PageHeader`, `PageToolbar`, `ErrorState`,
`AppDataTable`, `EmptyState`. `PageToolbar` is a PrimeVue `Toolbar` with a `mb-4`
margin and `#filters` / `#bulk` / `#actions` slots plus a `v-model:search` field.
It is meant to be a page-level control that sits *above* the table card.

In practice two structures coexist across list views:

- **Compliant** (toolbar outside the card) — e.g. `QuotaListView`:
  ```
  PageHeader
  PageToolbar
  ErrorState (v-if error)
  <div class="card"> AppDataTable </div>
  ```
- **Non-compliant** (toolbar nested inside the card) — e.g. `CompaniesView`:
  ```
  PageHeader
  ErrorState (v-if error)
  <div class="card">
    PageToolbar
    AppDataTable
  </div>
  ```

Line-position analysis of the 26 views using `PageToolbar` shows ~14 nest the toolbar
inside the card (toolbar line number is greater than the `.card` line number). The rest
already match the target, or are report views with a different (non-card / multi-panel)
shape that this change leaves alone.

## Goals / Non-Goals

**Goals:**
- One canonical list-page structure everywhere: `PageHeader` → `PageToolbar` →
  `ErrorState` → `.card`(optional hint + data table).
- Move `PageToolbar` outside the `.card` on every non-compliant list view, preserving
  its search binding, slot contents, and permission gating verbatim.
- Encode the placement rule in the `web-app-layout` spec so future pages inherit it.

**Non-Goals:**
- No change to `PageToolbar`, `PageHeader`, `ErrorState`, or `AppDataTable` component
  internals (props, slots, styling).
- No change to which actions/filters a page exposes, or their permission codes.
- No restructuring of report views that legitimately use multiple panels instead of a
  single data-table card, and no change to detail pages.
- No backend, DTO, i18n-key, or data-model change.

## Decisions

1. **Placement: toolbar is a sibling above the card, not a child of it.** In each
   non-compliant view, lift the `<PageToolbar>…</PageToolbar>` block out of
   `<div class="card">` and place it between `PageHeader` and `ErrorState`. Because the
   toolbar already carries `mb-4`, no extra spacing markup is needed.

2. **ErrorState stays a peer that replaces the card.** Keep the existing
   `<ErrorState v-if="…error" … />` / `<div v-else class="card">` pairing. The toolbar
   renders regardless of error state (it sits above `ErrorState`), matching the
   compliant views. This means search/filter controls remain visible even on a failed
   load — consistent with `QuotaListView` today.

3. **Hint lives inside the card, above the table.** Where a page has an explanatory
   hint line, it stays as the first child inside `.card`, before `AppDataTable`
   (matching the diagram: `card → hint → DataTable`). Pages without a hint simply omit
   it; the requirement does not force one.

4. **Mechanical, view-by-view edit.** Each view is edited independently; there is no
   shared wrapper component to introduce. This keeps the diff reviewable and avoids
   coupling unrelated pages. A follow-up could extract a `ListPageLayout` wrapper, but
   that is out of scope here.

5. **Spec change is MODIFIED, not ADDED.** The existing "List Page Toolbar" requirement
   already governs the toolbar; we amend it to state placement (outside/above the data
   card) and add a page-structure scenario, rather than introducing a new requirement.

## Risks / Trade-offs

- **Selection-driven bulk toolbars.** A few views (e.g. `ApprovalInboxView`,
  `MyDocumentsView`) bind `:selection-count` to table state. Moving the toolbar out of
  the card must not break that binding — the state lives in the view's setup, not in the
  card DOM, so lifting the element is safe, but each such view needs a visual/smoke check.
- **Per-view drift.** Editing ~14 files by hand risks small inconsistencies (stray
  wrapper divs, lost `v-if`). Mitigation: after edits, re-run the line-position analysis
  to confirm every list view now has `toolbar < card`, and run the view smoke tests +
  `vue-tsc`.
- **Report views excluded.** Leaving report/multi-panel views as-is means "every page"
  is really "every single-table list page." That is intentional and called out so the
  scope reads honestly rather than implying a blanket sweep.

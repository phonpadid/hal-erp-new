## Context

The Vue shell (`AppLayout`, `AppTopbar`, `AppSidebar`, `AppConfigurator`) is already a faithful
sakai-vue port, and dashboard widgets (`StatCard`, `BudgetUtilizationWidget`) already model
per-widget loading / error states with `Skeleton` + `Message`. The gap is the body of every
in-app page. Today a list view is uniformly:

```
PageHeader → .card → DataTable( :loading, <template #empty><span class="text-muted-color">…)
```

That gives: spinner-only loading, plain-text empty, ad-hoc `Message` error banners, and no
toolbar — so search/filter/bulk-action/export affordances don't exist and every page looks the
same. Detail views are a stack of bare `.card`s with no shared status header. Sakai's own
`Crud.vue` shows the intended pattern: a `Toolbar` with start/end slots, an `IconField` global
search, selectable rows driving bulk actions, and skeleton-based loading.

This is a presentation-only refactor inside the existing `web-app-layout` capability. Constraints
from CLAUDE.md that bound it: PrimeUI theme tokens only (no hardcoded colors, light/dark must
both work), PrimeIcons, all text via i18n with en/la parity, money via `formatAmount` (never a JS
number), and UI affordances gated by **permission code** from the active-company Pinia context.

## Goals / Non-Goals

**Goals:**
- A tiny set of reusable, presentational components that make each page type look finished and
  give it the controls it needs: `PageToolbar`, `EmptyState`, `ErrorState`, `TableSkeleton`,
  `DetailHeader`, `SectionCard`, `FormStepper`, `EventTimeline`.
- Consistent loading / empty / error treatment across all in-app content regions.
- Inputs matched to the data shape (long text → `Textarea`/`Editor`), long forms presented as
  steps, and event history presented as a timeline.
- A sidebar grouped into labelled, permission-gated sections instead of one flat list.
- Adopt the kit across existing views without changing their data flow, stores, routes, or the
  permission codes that gate their actions.

**Non-Goals:**
- No backend, API, DBML, migration, or store-contract changes.
- No new permissions and no change to what is gated — only how gated controls are presented.
- Not building a generic CRUD abstraction or a design-system package; these are thin wrappers
  over PrimeVue, not a framework. Bulk **mutations** (mass delete/approve) are only wired where a
  store action already exists; otherwise the `#bulk` slot is simply left unused.
- Not touching the auth/login/select-company screens (they are outside the main layout).

## Decisions

**1. Thin wrappers over PrimeVue, not new primitives.** `PageToolbar` wraps `Toolbar` +
`IconField`/`InputText`; `TableSkeleton` composes `Skeleton`; states use `Message`/plain markup.
Rationale: matches the existing `PageHeader`/`StatCard` style, keeps bundle and cognitive cost
low, and stays inside the "configuration over code" spirit. Alternative considered — adopting a
third-party Vue table/toolbar kit — rejected as redundant with PrimeVue and a theming risk.

**2. Slot-driven, uncontrolled where possible.** `PageToolbar` exposes `search` via
`v-model:search` plus `#filters`, `#bulk`, `#actions` slots; it owns no data-fetching. Pages keep
their `DataTable` and `filters` ref and pass the global filter through, exactly as sakai's
`Crud.vue` does. Rationale: each view already owns its store and selection state; the kit should
decorate, not capture, that state. This keeps the blast radius to template changes.

**3. One explicit state at a time via a documented convention, not a magic component.** Rather
than a single `<DataState>` that hides the table, each list renders, in order: `ErrorState` when
`store.error`; `TableSkeleton` when `loading && !list.length`; `EmptyState` via the DataTable
`#empty` slot otherwise. Rationale: keeps `DataTable` behavior (sorting, paging) intact and avoids
a leaky abstraction; the consistency comes from the shared components + a short usage rule in the
spec, which is testable per page.

**4. Selection enables bulk, gated by the same code as the row action.** When a view supports a
bulk operation, it adds `selection`/`v-model:selection` to its `DataTable` and renders the `#bulk`
slot guarded by the identical `auth.can(CODE)` already used for the single-row action. Rationale:
preserves the invariant that authorization is by permission code and never widens what a user can
do — the server remains authoritative.

**5. Field control chosen from the field type, not hardcoded.** Dynamic form fields are already
described by a `fieldType` (`CreateDocumentView` renders them in a `v-for`). A small
`fieldComponent(fieldType)` map resolves the control: `text` → `InputText`, `number`/`date` →
typed `InputText`, `textarea`/`long_text` → `Textarea` (`autoResize`), `richtext`/`html` →
`primevue/editor` `Editor` with `editorStyle="height: 320px"`. Rationale: keeps the
"configuration over code" rule — behaviour follows the field definition, not a per-type `if` — and
upgrades long-text entry without touching the submit payload (Editor binds an HTML string;
Textarea a plain string). Alternative — always `Textarea` — rejected because short fields and
rich-text fields both deserve their proper control. `Editor` pulls in `quill`; load it only on
views that use it.

**6. Long forms as a `Stepper`, same payload.** `FormStepper` wraps PrimeVue `Stepper`/`StepList`
/`StepPanels`. The create-document form splits into steps (header → dynamic fields → line items →
review) with per-step required-field checks reusing the existing `validateRequired`; the final
submit builds the **same** request body as today. Rationale: reduces a long scroll to digestible
steps without a backend or DTO change, so it's a pure presentation refactor. Alternative — PrimeVue
`Accordion` — rejected: a wizard better signals progress and gates completion.

**7. Event history as `EventTimeline`.** The approval history (`approvalLog`), currently a
`DataTable`, renders through `EventTimeline` (wraps PrimeVue `Timeline`) with a status-coloured
marker, actor, timestamp, and remark per entry. Rationale: the data is inherently sequential;
a timeline reads as a story and matches sakai. The component is generic (takes `events` with
`{ icon, severity, title, subtitle, at, body }`) so other logs can reuse it.

**8. Grouped, permission-gated sidebar.** Add an optional `section` key to each `NAV` entry and
build `model` by grouping entries into ordered sections (Workspace; Budget & Quota; Master Data;
Administration), each a `{ label, items }` block separated in the menu. Sections whose every entry
is filtered out by `visibleNav` are dropped, so an admin-less user sees no empty Administration
heading. Rationale: keeps the single source of truth (`NAV`) and the existing permission filter;
only the shaping into sections is new. The existing `AppMenu`/`AppMenuItem` already render nested
`items` and `separator`, so no menu-component change is needed.

**9. i18n: a shared `components.*` namespace plus per-page overrides.** Generic labels (search
placeholder, "Clear filters", "Retry", default empty/error titles) live under a new
`components.state.*` / `components.toolbar.*` namespace; page-specific empty messages keep their
existing `*.list.empty` keys and are passed in as props. Rationale: avoids duplicating boilerplate
across views while letting each page say something specific. en/la parity is enforced by the
existing `i18n.parity.spec.ts`.

## Risks / Trade-offs

- **Wide but shallow diff (many views touched)** → Land the components first with their own tests,
  then migrate views one capability at a time so each PR/slice is reviewable and the app stays
  green between steps.
- **Skeleton column count drifting from real columns** → `TableSkeleton` takes a `columns` (and
  `rows`) prop set from the view; document it next to the table so they're edited together.
- **Bulk actions could imply capabilities a role lacks** → `#bulk` is rendered only behind the
  existing permission code and only where a real store action exists; no new endpoints, so the
  server still rejects anything the client shouldn't have shown.
- **Dark-mode/token regressions** → Components use only theme tokens (`text-color`,
  `text-muted-color`, `bg-*`, `border-*`); verified in both modes via the configurator, matching
  how `StatCard` is already built. The `Editor` (Quill) toolbar must be checked in dark mode and
  styled via PrimeUI tokens if its default chrome doesn't adapt.
- **Editor changes the stored value shape (HTML vs plain text)** → Use `Editor` only for fields
  whose type is rich-text/html; plain long-text stays `Textarea` returning a string. The submit
  payload mapping is unchanged.
- **Stepper could let an incomplete step advance** → Reuse `validateRequired` per step and block
  "Next"/submit until the step's required fields pass, preserving today's validation behaviour.
- **Quill bundle weight** → Import `Editor` only in the views that need it (code-split), not
  globally.

## Migration Plan

1. Add the components under `front-end/src/components/` with unit tests (render, empty/error
   branches, permission-gated bulk slot, field-type→control map, stepper step gating, timeline
   rendering) and the new `components.*` i18n keys (en + la). Add `quill` if missing.
2. Group the sidebar: add `section` to `NAV` and build sectioned `model` in `layout.store.ts`;
   update store tests for section grouping + empty-section drop.
3. Migrate list views to `PageToolbar` + `TableSkeleton` + `EmptyState`/`ErrorState`
   (budgets → documents → approvals → quota → master → notifications → admin).
4. Migrate detail views to `DetailHeader` + `SectionCard`, and the approval history to
   `EventTimeline`.
5. Convert the create-document form to `FormStepper` and route dynamic fields through the
   field-type→control map (textarea/editor).
6. Remove now-dead inline empty/error/table markup; run i18n parity + no-literal-text specs.

Rollback is trivial: the change is additive components plus template edits; reverting the view
edits restores prior behavior with no data or schema impact.

## Open Questions

- Should export (CSV) be enabled on every list now, or only where a clear user need exists? Lean:
  expose the `#actions` export slot in the component but only wire it per view where useful.
- Do we want a shared `useTableFilters` composable for the global-filter boilerplate, or keep the
  three-line `filters` ref inline per view? Lean: inline for now; extract only if repetition hurts.

## Context

The Sakai shell already centralizes the content region: `AppLayout.vue` →
`.layout-main-container` (`padding: 6rem 2rem 0`) → `.layout-main` → `<router-view/>`.
But every view then re-wraps its body in its own `max-w-* mx-auto`
(`7xl/5xl/4xl/3xl/xl`), so the effective page width — and the left/right gutter —
changes per route. A shared kit exists (`PageHeader`, `SectionCard`, `DetailHeader`,
`PageToolbar`, `EmptyState`, `ErrorState`, `TableSkeleton`, `EventTimeline`), but
`SectionCard` is a hand-rolled `.card` div and several views render summary data as
bare `<div><span>…</span> value</div>` grids or plain `<p>` text.

Decisions confirmed with the user: **full-width** content on every in-app page, and
**convert bare text → PrimeVue panel components across all views as appropriate**.

## Goals / Non-Goals

**Goals**
- One content region, sized once by the shell; identical horizontal gutters on every
  in-app route; no per-view width.
- Section/group chrome comes from shared PrimeVue panel components, consistent and
  theme-aware.

**Non-Goals**
- No change to `login` / `select-company` (public full-screen pages keep their own
  centering).
- No backend/API/permission change. No new navigation or routes.
- Not redesigning information architecture — only the container/chrome around
  existing content.

## Decisions

**Decision: full-width via the existing shell seam; delete per-view wrappers.**
Remove every `max-w-* mx-auto` wrapper in `src/views/**` so `.layout-main` (with the
container's `2rem` horizontal padding) is the single thing that sizes content. Pages
render edge-to-edge within that padding.
- *Alternative — a `PageContainer` component with a width prop*: rejected for now; the
  user chose a single full-width treatment, so a width-bearing wrapper would just
  reintroduce per-page variance. The shell padding is the one seam.

**Decision: re-back `SectionCard` with PrimeVue `Panel`, keep its public API.**
`SectionCard` keeps its props (`title`, `subtitle`) and slots (`#default`,
`#actions`) but renders a PrimeVue `Panel` (title in the header, `#actions` in the
header's icons region) instead of a bare `.card` div. Every detail/section caller
(e.g. `DocumentDetailView`) inherits consistent panel chrome with zero call-site
changes.
- *Alternative — `Fieldset`*: better for form field groups specifically; we use it at
  the call sites that are forms, not as the generic section container.

**Decision: a small mapping guide for which panel component to use.**
Applied per view "as appropriate":
- `Panel` — generic titled content section (the `SectionCard` default).
- `Fieldset` — a labeled group of form fields (create/company forms).
- `Card` — a self-contained dashboard widget / standalone tile.
- `Divider` — separate stacked sub-sections or inline items in a summary grid.
- `Accordion` — long or secondary groups the user can collapse (e.g. approval
  history, advanced sections).
- `ScrollPanel` — a bounded scroll region for long lists (e.g. timelines) so page
  scroll stays predictable.
- `Splitter` — only where a true side-by-side master/detail split is wanted.

All components are imported locally per view (none are globally registered today),
labels via `$t(...)` (en/la), colors via PrimeUI tokens only.

## Risks / Trade-offs

- [PrimeVue `Panel` default padding/borders differ from the old `.card`] → verify
  spacing on a detail page and adjust via theme tokens / utility classes, not
  hardcoded values; keep `SectionCard`'s outer rhythm.
- [Full-width makes wide data tables and short forms stretch awkwardly on large
  monitors] → tables already scroll/fit; forms keep their fields in a constrained
  inner grid (the *page* is full-width, the *form control column* need not be).
- [Dark-mode regression when swapping components] → covered by the existing
  dark-mode scenario; spot-check each converted view.
- [Per-view churn across ~18 files] → mechanical and low-risk; component + layout
  unit tests are the safety net.

## Migration Plan

Pure frontend refactor, ship in one release. Rollback = revert the view wrappers and
`SectionCard`. No data or config migration.

## Open Questions

None — width (full-width) and panel scope (all views, as appropriate) are decided.

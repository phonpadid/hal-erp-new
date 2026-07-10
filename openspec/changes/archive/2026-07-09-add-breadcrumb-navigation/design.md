## Context

Authenticated routes render inside `AppLayout.vue` → `AppTopbar` / `AppSidebar` (menu) /
`layout-main-container > layout-main > router-view`. The sidebar navigation is generated from a
single metadata table, `NAV: NavEntry[]` in `front-end/src/layouts/store/layout.store.ts`, where
each entry has `{ key, icon, to, permission, section }`; labels come from i18n (`nav.<key>` and
`nav.sections.<section>`) and `groupNav(can)` filters/groups entries by permission. Routes carry
`meta: { public?, requiresCompany?, permission? }` in `front-end/src/router/index.ts`.

There is no PrimeVue `Breadcrumb` in use today; the only breadcrumb is a bespoke `<nav>` inside
`DocumentDetailView.vue`. PrimeVue's `Breadcrumb` takes `:home` (a single `MenuItem`) and
`:model` (a `MenuItem[]` trail); each item supports `label`, `icon`, `route`/`url`, and `command`.

The user asked to add `<Breadcrumb :home="home" :model="items" />` to "every page that should use
it". The chosen approach (confirmed with the user) is **central + auto-derive**: render one shared
breadcrumb in the shell and derive the trail from route metadata + `NAV`, with an escape hatch for
dynamic leaves.

## Goals / Non-Goals

**Goals:**
- Every authenticated in-app page shows a consistent breadcrumb `Home → Section → Page` (plus any
  dynamic leaf), rendered once by the shell — no per-view boilerplate for the common case.
- Reuse the existing `NAV`/i18n label source of truth so breadcrumb labels never drift from the
  sidebar, and honour permission-gated navigation (no crumb links to a page the active company
  can't access).
- Let detail/dynamic pages append their own crumbs (docNo, budget name, "Edit", "New") without
  editing the shell.
- Full en/la i18n parity and PrimeUI theme tokens (light/dark).

**Non-Goals:**
- No backend/API/data-model changes.
- Not adding breadcrumbs to unauthenticated pages (login, password reset, verify email,
  select-company) — those render outside `AppLayout`.
- Not changing the sidebar, topbar, or the `NAV` structure itself.
- Not a router refactor into nested `children` for every list/detail pair (kept flat; trail comes
  from `meta` instead).

## Decisions

### Decision 1: One shared `AppBreadcrumb` rendered by the shell, not per-view
Render `<AppBreadcrumb />` once in `AppLayout.vue`, in `layout-main` immediately above
`<router-view>`. It computes `home` and `model` internally from the current route.

- **Why:** ~50 in-app routes; per-view `<Breadcrumb>` (the literal ask) would duplicate the same
  `home`/`items` wiring 50× and drift constantly. Centralising matches the existing pattern where
  the sidebar is generated from `NAV`, guarantees identical placement/styling on every route, and
  still uses the PrimeVue `Breadcrumb` the user referenced — just once.
- **Alternative considered:** per-view `<Breadcrumb :home :model />` in each view. Rejected:
  high-churn, error-prone, inconsistent. The composable (Decision 3) preserves the per-page
  flexibility that motivated the literal ask.

### Decision 2: Trail derived from `route.meta.breadcrumb` + `NAV`, home = Dashboard
`home` is always `{ icon: 'pi pi-home', route: '/' }` (Dashboard). The static trail is built as:
1. Look up the matched route in `NAV` by its resolved path; if found, emit
   `Section (label only, no link) → Entry (label, links to entry.to)`.
2. For routes not directly in `NAV` (detail/new/edit/report sub-pages, workflow steps), the route
   declares `meta.breadcrumb`: an ordered list of ancestor crumbs, each either a `nav` key
   reference (reuse `NAV` label + link) or an explicit `{ labelKey, to? }`. Example:
   `document-detail` → `[{ nav: 'documents' }]` so the trail is `Documents → <leaf>`.
3. Section headings render as non-link text (they have no single destination); page entries render
   as `RouterLink`s except the current page (leaf), which is plain text.

- **Why:** `NAV` already encodes section + label + permission + path; deriving from it keeps one
  source of truth and automatically inherits permission gating and i18n. `meta.breadcrumb` covers
  the routes `NAV` doesn't list (deep pages) with minimal per-route data.
- **Alternative considered:** encode the full trail in each route's `meta`. Rejected: duplicates
  labels already in `NAV` and would drift from the sidebar.
- **Permission gating:** a crumb links to a target only if `auth.can(<its permission>)`; otherwise
  it renders as plain text (still shows the label, just not clickable), mirroring the sidebar rule
  (UX only; server authoritative).

### Decision 3: `useBreadcrumb()` composable for dynamic leaves
A composable exposing a small reactive store (module-level `ref<MenuItem[]>` or Pinia) that pages
call to append trailing crumbs:
```ts
// in DocumentDetailView setup
useBreadcrumb(() => [{ label: doc.value?.docNo ?? '' }]);
```
`AppBreadcrumb` concatenates the derived static trail with these dynamic crumbs. The composable
registers an `onBeforeRouteLeave` / watch that clears its contribution on navigation so crumbs
never leak across pages. The last item in the final `model` is treated as the current page (no
link) regardless of source.

- **Why:** detail pages need runtime data (docNo, budget name) the router can't know statically;
  a composable keeps that opt-in and local to the page, preserving the "per-page control" the
  user's example implied, without each page re-rendering its own `<Breadcrumb>`.
- **Alternative considered:** async label resolvers in route meta. Rejected: pages already load the
  record; re-fetching for a label duplicates work and complicates the router.

### Decision 4: Replace the bespoke breadcrumb in `DocumentDetailView`
Remove the hand-rolled `<nav>` trail and drive it via `meta.breadcrumb: [{ nav: 'documents' }]`
plus `useBreadcrumb(() => [{ label: docTypeName }, { label: doc.docNo }])`, so it matches every
other page.

- **Why:** consistency; avoids two breadcrumb implementations.

### Decision 5: i18n and theming
Labels reuse existing `nav.*` keys wherever a crumb maps to a nav entry. New crumb labels (e.g.
`New`, `Edit`, report titles not in `NAV`, `breadcrumb.home` aria) get keys under a `breadcrumb.*`
namespace with en/la parity. `AppBreadcrumb` uses PrimeVue `Breadcrumb` (PrimeUI tokens) so light
and dark both work; no hardcoded colors.

## Risks / Trade-offs

- **Path/NAV matching fragility** (a route whose path doesn't line up with a `NAV.to`) → derive
  the match from the resolved route record and fall back to `meta.breadcrumb`; add a unit test that
  every in-app route yields a non-empty trail so a missing mapping fails CI, not silently.
- **Stale dynamic crumbs leaking between pages** → the composable clears its contribution on route
  change; covered by a test that navigating detail → list resets the trail.
- **Breadcrumb linking to a forbidden page** → gate each crumb link by its permission code
  (Decision 2); non-permitted crumbs render as text, not links.
- **Duplicate "current page" as both section-entry and leaf** on list routes that ARE nav entries
  → when the route itself is the nav entry, that entry is the leaf (plain text), no dynamic crumb
  appended; handled in derivation, covered by a test on a plain list route.
- **Extra vertical space above content** → keep the breadcrumb compact (single line, small text)
  and only render when the trail has more than just Home, so the dashboard itself shows no redundant
  crumb.

## Migration Plan

Additive, frontend-only, no data migration. Ship `AppBreadcrumb` + composable + route meta + i18n
together; remove the `DocumentDetailView` bespoke breadcrumb in the same change. Rollback = revert
the frontend commit. No feature flag needed (pure UX addition).

## Open Questions

- Should the breadcrumb render on the Dashboard (`/`) itself? Proposed: no — when the trail is only
  Home, render nothing (avoids a redundant single "Home" crumb). Confirm during apply.
- Icon vs text-only for section crumbs? Proposed: text-only sections, home as icon; revisit if the
  design system prefers icons per crumb.

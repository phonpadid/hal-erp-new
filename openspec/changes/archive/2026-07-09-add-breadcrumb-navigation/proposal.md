## Why

In-app pages currently give no consistent "where am I / how do I go back up" affordance. Only
`DocumentDetailView` has a hand-rolled breadcrumb `<nav>`; every other list, detail, form, and
report page relies on the sidebar highlight alone. Deep routes (document/budget/quota detail,
workflow steps, report sub-pages) leave the user without a labelled trail back to their parent
list or the dashboard. We want one consistent breadcrumb on every authenticated page, built on
PrimeVue `Breadcrumb`.

## What Changes

- Add a shared `AppBreadcrumb` component (wrapping PrimeVue `Breadcrumb`) rendered **once** by the
  application shell (`AppLayout`), so every authenticated in-app page shows a breadcrumb without
  per-view wiring.
- Derive the breadcrumb trail automatically from the active route's metadata plus the existing
  `NAV` section/label table (single source of truth already used by the sidebar): `Home
  (Dashboard) → Section → Page`, using the same i18n labels the sidebar shows.
- Provide a `useBreadcrumb()` composable so detail/dynamic pages (e.g. document detail, budget
  detail, quota detail, workflow step edit) can contribute the final dynamic crumb (docNo, budget
  name, etc.) and any intermediate crumbs, replacing the bespoke breadcrumb currently in
  `DocumentDetailView`.
- Add breadcrumb metadata (`meta.breadcrumb`) to in-app routes and the corresponding i18n keys
  (en/la parity) for any labels not already covered by `nav.*`.
- Breadcrumb links respect permission-gated navigation and use PrimeUI theme tokens (light/dark),
  home links to the dashboard, and the current page is the non-link leaf.

No backend, data-model, or API changes. This is a frontend shell/navigation enhancement only.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-app-layout`: Add a "Breadcrumb Navigation" requirement to the application shell — every
  authenticated in-app page renders a shared breadcrumb whose trail is derived from route metadata
  and the permission-gated navigation model, with i18n (en/la) labels and PrimeUI theme tokens,
  and detail/dynamic pages contribute their own leaf crumb.

## Impact

- **Frontend only.** Affected code:
  - `front-end/src/layouts/AppLayout.vue` — render `AppBreadcrumb` once above `router-view`.
  - New `front-end/src/layouts/AppBreadcrumb.vue` (or `components/AppBreadcrumb.vue`) — wraps
    PrimeVue `Breadcrumb`, computes `home` + `model` from route meta and `NAV`.
  - New `front-end/src/composables/useBreadcrumb.ts` — lets dynamic pages set trailing crumbs;
    auto-clears on route change.
  - `front-end/src/router/index.ts` — add `meta.breadcrumb` to in-app routes.
  - `front-end/src/layouts/store/layout.store.ts` — reuse `NAV`/`groupNav` for label lookup
    (no structural change expected).
  - `front-end/src/views/documents/DocumentDetailView.vue` — remove the bespoke `<nav>`
    breadcrumb in favour of the shared one.
  - `front-end/src/i18n/locales/{en,la}/*` — breadcrumb labels for any non-`nav` crumbs.
- **Invariants:** touches invariant 5 (permission codes) only in the UX sense — breadcrumb links
  must not expose navigation the active company lacks permission for; the server stays
  authoritative. No budget/quota/ledger invariants involved.

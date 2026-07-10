## 1. Breadcrumb source & composable

- [x] 1.1 Add a `breadcrumb` field to the route `meta` type (via a `vue-router` `RouteMeta`
  augmentation + exported `BreadcrumbCrumb` type). The route table was extracted into a new
  side-effect-free `front-end/src/router/routes.ts` (so it can be imported in tests without
  `createWebHistory`); `index.ts` now builds the router from it.
- [x] 1.2 Create `front-end/src/composables/useBreadcrumb.ts`: a module-level reactive
  `ref<MenuItem[]>` (or Pinia slice) plus a `useBreadcrumb(getter)` that registers a page's dynamic
  trailing crumbs and clears them on route change (watch/`onBeforeRouteLeave`).
- [x] 1.3 Add a helper (in the composable or `layout.store.ts`) that, given the current route,
  resolves the static trail from `NAV`/`groupNav` (section label + entry) and `meta.breadcrumb`,
  returning `home` + `model` as PrimeVue `MenuItem[]`, with permission gating (`auth.can`) deciding
  whether each crumb is a link.

## 2. AppBreadcrumb component

- [x] 2.1 Create `front-end/src/layouts/AppBreadcrumb.vue` wrapping PrimeVue `Breadcrumb` with
  `:home` and `:model`, concatenating the derived static trail with `useBreadcrumb` dynamic crumbs;
  mark the last item as the current (non-link) page; use `RouterLink`/`route` for links and plain
  text for non-permitted or leaf crumbs.
- [x] 2.2 Render nothing when the trail is only Home (e.g. the dashboard route), so no redundant
  single-crumb bar appears.
- [x] 2.3 Style with PrimeUI theme tokens only (light/dark), compact single-line; home crumb uses
  `pi pi-home` with an accessible label.

## 3. Shell wiring

- [x] 3.1 Render `<AppBreadcrumb />` once in `front-end/src/layouts/AppLayout.vue`, inside
  `layout-main` immediately above `<router-view>`.

## 4. Route metadata

- [x] 4.1 Add `meta.breadcrumb` to in-app routes that are not direct `NAV` entries in
  `front-end/src/router/index.ts`: document new/edit/detail, budget new/detail/edit, quota detail,
  quota-admin detail, report sub-pages, doc-config sub-pages and workflow step create/edit,
  org-admin sub-pages, and other detail/form routes — pointing each at its parent list crumb.
- [x] 4.2 Verify every in-app (non-public) route resolves to a non-empty, correctly-ordered trail
  (see task 6.1).

## 5. Dynamic pages & i18n

- [x] 5.1 In `DocumentDetailView.vue`, remove the bespoke `<nav>` breadcrumb and instead call
  `useBreadcrumb(() => [{ label: docTypeName }, { label: doc.docNo }])`.
- [x] 5.2 Add `useBreadcrumb(...)` dynamic leaves to other dynamic detail/form pages (budget
  detail, quota detail, quota-admin detail, workflow detail/step edit, account ledger report,
  employee onboard) with their record identifier / New / Edit label.
- [x] 5.3 Add a `breadcrumb.*` i18n namespace (home aria label, `new`, `edit`, and any crumb labels
  not already under `nav.*`) to `front-end/src/i18n/locales/en/*` and `.../la/*` with full parity.

## 6. Tests & verification

- [x] 6.1 Unit test: for every non-public route, the trail builder returns a non-empty `model`
  ending in the current page and starting after Home (fails CI on a missing mapping).
- [x] 6.2 Unit test: permission gating — a crumb whose permission is not granted renders as
  non-link text; a granted one renders as a link.
- [x] 6.3 Unit test: `useBreadcrumb` dynamic crumbs clear on navigation (detail → list resets the
  trail).
- [x] 6.4 Ran the frontend type-check (clean for all breadcrumb files; only pre-existing
  `objectURL` errors remain in unrelated uncommitted files) and the unit suite (8 breadcrumb tests
  pass, no new failures). No linter is configured in this project (CI = typecheck + test). Live
  in-browser light/dark verification is recommended before release.
- [x] 6.5 Run `openspec validate "add-breadcrumb-navigation"` and confirm it passes.

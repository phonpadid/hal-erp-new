## 1. Routing

- [x] 1.1 Add route `{ path: 'quota-admin/:id', name: 'quota-admin-detail', component: QuotaAdminDetailView, meta: { permission: 'QUOTA_MANAGE' } }` in `front-end/src/router/index.ts`, directly after the existing `quota-admin` route.
- [x] 1.2 Import `QuotaAdminDetailView` from `../views/admin/QuotaAdminDetailView.vue`.

## 2. Quota list view (remove tabs)

- [x] 2.1 In `front-end/src/views/admin/QuotaAdminView.vue`, remove the `Tabs`/`TabList`/`Tab`/`TabPanels`/`TabPanel` imports and markup; render the quotas `AppDataTable` and its `PageToolbar` directly inside the card.
- [x] 2.2 Change the per-row "manage entitlements" button to `router.push({ name: 'quota-admin-detail', params: { id: data.id } })` (via `useRouter`); remove the `manageEntitlements`/`reloadEntitlements` tab-switch logic and the `activeTab` ref.
- [x] 2.3 Remove the entitlements `TabPanel` and its dialogs (set-entitlement, mid-year adjust, carry-forward) and the entitlement-only refs (`entDialog`, `adjustDialog`, `carryDialog`, `entYear`, `selectedQuota`) from this view — they move to the detail view.
- [x] 2.4 Keep the quota create/edit dialog and `submitQuota`/`deactivate` here.

## 3. Quota detail view (entitlements)

- [x] 3.1 Create `front-end/src/views/admin/QuotaAdminDetailView.vue` reading `route.params.id`; on mount call `store.loadEntitlements(id, currentYear)` and load the quota context.
- [x] 3.2 Render a `DetailHeader` with a back link to `/quota-admin` and a context block showing the quota's type, unit, level, reset cycle, carry-forward policy, and pool remaining — sourced from `store.list` when present, else `quotasApi.get(id)` / `quotasApi.breakdown(id)` so a deep-linked/refreshed page still has context.
- [x] 3.3 Render the year filter (`InputNumber`) + filter button and the entitlements `AppDataTable` (employee / year / entitled base / carried / adjusted / entitled total / used / remaining), calling `store.loadEntitlements(id, year)` on year change.
- [x] 3.4 Move the set-entitlement, mid-year adjustment (`adjustDialog`), and carry-forward dialogs and their submit handlers into this view, gated on `canManage` (`QUOTA_MANAGE`).
- [x] 3.5 Ensure entitlement writes reload via `store.loadEntitlements(id, ...)` so the table refreshes for the routed quota.

## 3b. Quota list filters

- [x] 3b.1 Add client-side filters to `QuotaAdminView.vue`: a type search plus level (company-wide / department, derived from loaded rows), reset-cycle, and carry-forward selects, with a clear action.
- [x] 3b.2 Load the full quota set (`loadList(1, 100)`) and paginate the filtered result client-side so filters apply across the whole set (backend list is pagination-only).
- [x] 3b.3 Add `common.clear` and `admin.quotaAdmin.filterByType` i18n keys (en + la).

## 4. Store & i18n

- [x] 4.1 In `front-end/src/stores/quotaAdmin.ts`, add a small `loadQuota(id)` (or reuse `list`) helper for deep-link header context if needed; keep `selectedQuotaId`/`entitlementYear`/`entitlements` shape unchanged.
- [x] 4.2 In `front-end/src/i18n/locales/en/admin.ts` and `.../la/admin.ts`, remove the `quotaAdmin.tabs.*` keys and add detail-page labels (back link, quota context labels). Grep templates for `quotaAdmin.tabs` to confirm no dangling references.

## 5. Verification

- [x] 5.1 Update `front-end/src/test/smoke/views.smoke.spec.ts` to cover `/quota-admin/:id`.
- [x] 5.2 Manually verify: `/quota-admin` shows the list with no tabs; clicking a quota's manage-entitlements action navigates to `/quota-admin/:id`; set/adjust/carry-forward work and refresh the table; a `QUOTA_VIEW`-only user sees no write actions; direct load of `/quota-admin/:id` shows quota context.
- [x] 5.3 Run typecheck/lint and the frontend smoke tests.

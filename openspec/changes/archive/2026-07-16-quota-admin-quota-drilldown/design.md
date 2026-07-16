## Context

`QuotaAdminView.vue` today is a single route (`/quota-admin`, `QUOTA_MANAGE`) built
from a PrimeVue `Tabs` with two panels:

- **Quotas** — the definitions `AppDataTable` (create/edit/deactivate) plus a
  per-row "manage entitlements" button that only switches the tab and calls
  `store.loadEntitlements(quotaId, year)`.
- **Entitlements** — a `Select` (quota picker) + year `InputNumber`, the
  entitlements `AppDataTable`, and the set-entitlement / adjust / carry-forward
  dialogs, all keyed off `store.selectedQuotaId`.

The Pinia store (`stores/quotaAdmin.ts`) already separates list state from
entitlement state (`selectedQuotaId`, `entitlementYear`, `entitlements`) and all
mutating actions (`upsertEntitlement`, `adjustEntitlement`, `carryForward`) reload
via `loadEntitlements(selectedQuotaId)`. The APIs (`quotasApi`, `quotaAdminApi`) are
complete — this change never touches the backend.

The user visited `/quota-admin/3f4f2fd0-…` expecting a detail page; that route does
not exist yet.

## Goals / Non-Goals

**Goals:**
- Remove the tab layout; `/quota-admin` shows only the quotas list.
- Add `/quota-admin/:id` showing one quota's entitlements + set/adjust/carry-forward.
- Reach entitlements by drilling into a quota (row action → `router.push`), not by
  re-selecting from a dropdown.
- Preserve QUOTA_VIEW/QUOTA_MANAGE gating and company scope exactly as today.

**Non-Goals:**
- No backend/DTO/endpoint changes.
- No change to the read-only end-user `/quota` screens.
- No change to entitlement/adjustment/carry-forward business semantics.

## Decisions

**1. Split into list view + detail view, drive detail off the route param.**
`QuotaAdminView.vue` keeps the quotas `AppDataTable` and the quota create/edit
dialog only. A new `QuotaAdminDetailView.vue` owns the entitlements table, the year
filter, and the three entitlement dialogs. The detail view reads `route.params.id`
and calls `store.loadEntitlements(id, year)` on mount and on year change — replacing
the removed quota-picker `Select`. *Alternative considered:* keep one component and
toggle sections with `v-if` on the route param. Rejected — it keeps the two
concerns tangled and gives no clean back-navigation; two components mirror the
existing `QuotaListView`/`QuotaDetailView` end-user pair.

**2. Row "manage entitlements" navigates.** The list's `pi pi-users` button changes
from `manageEntitlements(data)` (tab switch) to `router.push({ name:
'quota-admin-detail', params: { id: data.id } })`. Clicking the quota row is the
sole entry to entitlements — matching "entitlement comes from quota".

**3. Detail header shows quota identity for context.** Since the picker is gone, the
detail page renders the quota's type / unit / level / reset cycle / carry-forward /
pool-remaining above the table. Source it from `store.list` when present, else fetch
`quotasApi.breakdown(id)` (already loaded per-row for pool remaining) so a
deep-linked/refreshed page still has context without relying on prior list state.

**4. Store stays the shape it is.** `selectedQuotaId`/`entitlementYear`/
`entitlements` remain; the detail view sets `selectedQuotaId` via
`loadEntitlements(id)`. The dropdown that used to mutate `selectedQuotaId` is gone,
so entitlement writes still reload the correct quota. No store API changes beyond
possibly a small `loadQuota(id)` helper for deep-link context.

**5. Route + permission.** Add `{ path: 'quota-admin/:id', name: 'quota-admin-detail',
component: QuotaAdminDetailView, meta: { permission: 'QUOTA_MANAGE' } }` directly
after the existing `quota-admin` route, mirroring `budgets/:id` and `quota/:id`.

## Risks / Trade-offs

- [Deep-link with empty list state — `store.list` not loaded, so no quota header] →
  detail view fetches its own quota context via `quotasApi.get`/`breakdown(id)` on
  mount rather than assuming the list ran first.
- [Back-navigation loses list pagination/scroll] → acceptable; the list reloads on
  mount as it does today. Router keeps history so the browser Back button returns.
- [i18n drift if `tabs.*` keys are removed but still referenced] → grep for
  `quotaAdmin.tabs` in both locale files and templates before deleting.

## Migration Plan

Pure frontend, no data migration. Ship the router + two views + i18n together.
Rollback = revert the frontend commit; no server or schema state changes.

## Open Questions

- Should the detail page keep the year as a query param (`?year=2026`) so a specific
  year is linkable, or default to current year each visit? Leaning query-param for
  linkability, but current-year default is acceptable for a first cut.

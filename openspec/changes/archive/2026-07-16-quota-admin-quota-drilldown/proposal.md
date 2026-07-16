## Why

The `/quota-admin` screen crams two unrelated jobs into one page behind tabs: a
company-wide **Quotas** list and an **Entitlements** panel where the admin must
re-pick a quota from a dropdown to see per-person allowances. The tab + re-select
flow is redundant — the admin already chose a quota in the list — and it makes the
per-quota entitlements un-linkable (no URL of their own). The user wants the tabs
removed and entitlement management reached *from* a quota, i.e. by drilling into a
single quota's detail page.

## What Changes

- **Remove the tab layout** on `/quota-admin`. The page becomes a single quota
  definitions list (create / edit / deactivate) — no `Tabs`/`TabPanel`.
- **Add a per-quota detail route** `/quota-admin/:id` that shows one quota's
  entitlements for a selected year, plus the set-entitlement, mid-year adjustment,
  and carry-forward actions that used to live in the Entitlements tab.
- **Reach entitlements from the quota**: the list's "manage entitlements" action
  navigates to `/quota-admin/:id` instead of switching tabs and re-selecting the
  quota from a dropdown. The quota dropdown/picker is removed.
- Detail page shows the quota's identity (type, unit, level, reset cycle,
  carry-forward policy, pool remaining) as context above the entitlement table.
- No backend, DTO, or endpoint changes — every API this uses already exists
  (`/quotas`, `/quotas/:id/breakdown`, entitlement/adjust/carry-forward admin
  endpoints).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-quota-admin`: the Quota Definition Management and Entitlement Management
  requirements change their **presentation contract** — definitions and
  entitlements are no longer co-located under tabs on one screen; entitlements
  (set / adjust / carry-forward) are presented on a per-quota detail screen
  reached by drilling into a quota. The underlying data rules (entitled / used /
  remaining, mid-year `adjusted`, carry-forward semantics) are unchanged.

## Impact

- Frontend only, in the quota-admin capability.
- `front-end/src/views/admin/QuotaAdminView.vue` — reduced to the quotas list.
- New `front-end/src/views/admin/QuotaAdminDetailView.vue` — per-quota entitlements
  + set/adjust/carry-forward dialogs.
- `front-end/src/router/index.ts` — add `quota-admin/:id` route (permission
  `QUOTA_MANAGE`).
- `front-end/src/stores/quotaAdmin.ts` — entitlement loading keyed off the route
  param; the `selectedQuotaId` dropdown state is no longer driven by a picker.
- i18n `admin.quotaAdmin.*` — drop the `tabs.*` keys, add detail-page labels.
- Smoke test `views.smoke.spec.ts` — cover the new detail route.
- **No cross-capability invariant is affected** — this is a read/write reshuffle of
  existing quota-admin screens; company scope and the QUOTA_VIEW/QUOTA_MANAGE
  permission gating are preserved.

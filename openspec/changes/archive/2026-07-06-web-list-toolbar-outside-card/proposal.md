## Why

List pages are inconsistent about where the shared `PageToolbar` (global search +
filters + actions) sits. On roughly half of the list views the toolbar renders
*inside* the `.card` that wraps the `DataTable`, so the filter bar shares the card's
surface and padding with the table. On the other half (e.g. `QuotaListView`,
`BudgetListView`, `ApprovalInboxView`) the toolbar sits *outside and above* the card.
The two treatments look different side by side and violate the "same-type pages share
the same affordances" intent of the layout spec. We want one canonical structure for
every list page so the filter bar reads as a page-level control, not part of the table
card.

## What Changes

- Standardize every list page to this vertical order:
  1. `PageHeader` (title + optional actions)
  2. `PageToolbar` (search / filters / primary + bulk actions) — **outside** the card
  3. `ErrorState` (retry) — shown in place of the card on load failure
  4. `.card` containing an optional hint line then the shared data table
- Move `PageToolbar` out of the `.card` on the ~14 list views that currently nest it
  inside, without changing the toolbar's slots, search binding, or permission gating.
- Tighten the **List Page Toolbar** requirement in `web-app-layout` so it mandates the
  toolbar be positioned above (outside) the data-region card, and add a scenario that
  pins the `PageHeader → PageToolbar → data card` order.
- No backend, API, data-model, or business-logic change; this is presentation only.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-app-layout`: the List Page Toolbar requirement gains an explicit placement rule
  (toolbar sits outside/above the data-region card) plus a canonical page-structure
  scenario.

## Impact

- **Specs:** `openspec/specs/web-app-layout/spec.md` (List Page Toolbar requirement).
- **Frontend views** (move `PageToolbar` outside `.card`): `admin/org/CompaniesView`,
  `admin/org/DepartmentsView`, `admin/org/HolidaysView`, `admin/org/FiscalYearsView`,
  `admin/EmployeeAdminView`, `admin/QuotaAdminView`, `admin/QuotaAdminDetailView`,
  `admin/doc-config/DocTypesView`, `admin/doc-config/FormTemplatesView`,
  `admin/doc-config/WorkflowsView`, `admin/doc-config/DeptMappingsView`.
- **Excluded — tabbed multi-list pages** (per-tab toolbar; kept as-is by decision):
  `master/MasterDataView`, `admin/RbacAdminView`, `admin/CurrencyAdminView`. These wrap a
  `<Tabs>` in one card with a separate `PageToolbar` per tab; a single page-level toolbar
  cannot serve each tab's distinct search/filters/actions. `admin/ApprovalConfigView` was
  already compliant and needed no change.
- **Unaffected views** (already compliant): `quota/QuotaListView`,
  `budgets/BudgetListView`, `approvals/ApprovalInboxView`, `payments/ReadyToPayView`,
  `notifications/NotificationInboxView`, `documents/MyDocumentsView`, and the report
  views.
- **Tests:** existing per-view smoke tests should keep passing; no new store/API mocks.
- **Invariants:** none affected — company isolation, ledgers, permission-code gating,
  and money formatting are untouched. Toolbar actions stay gated by their permission
  codes exactly as before.

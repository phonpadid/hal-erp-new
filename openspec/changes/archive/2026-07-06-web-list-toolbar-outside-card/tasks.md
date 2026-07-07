## 1. Confirm scope

- [x] 1.1 Re-run the line-position check (`.card` vs `<PageToolbar>` line numbers) across
  all views in `front-end/src/views` that import `PageToolbar`, and confirm the
  non-compliant set (toolbar line > card line). Found: `admin/ApprovalConfigView` was
  already compliant (dropped from scope); `MasterDataView`, `RbacAdminView`, and
  `CurrencyAdminView` are tabbed multi-list pages with a per-tab toolbar (see §5).
- [x] 1.2 For each non-compliant view, note whether it has an explanatory hint line and
  whether it binds `:selection-count`, so those are preserved during the move. None of
  the single-list targets bind `:selection-count`; hint lines live inside the card body
  and are untouched by the move.

## 2. Move PageToolbar outside the card (org / doc-config admin)

For each view: lift the `<PageToolbar>…</PageToolbar>` block out of `<div class="card">`
and place it between `PageHeader` and `ErrorState`; keep its slots, `v-model:search`
binding, and permission gating unchanged; leave any hint line as the first child inside
the card, before the data table.

- [x] 2.1 `admin/org/CompaniesView.vue`
- [x] 2.2 `admin/org/DepartmentsView.vue`
- [x] 2.3 `admin/org/HolidaysView.vue`
- [x] 2.4 `admin/org/FiscalYearsView.vue`
- [x] 2.5 `admin/doc-config/DocTypesView.vue`
- [x] 2.6 `admin/doc-config/FormTemplatesView.vue`
- [x] 2.7 `admin/doc-config/WorkflowsView.vue`
- [x] 2.8 `admin/doc-config/DeptMappingsView.vue`

## 3. Move PageToolbar outside the card (other admin + master data)

- [x] 3.1 `admin/EmployeeAdminView.vue`
- [x] 3.2 `admin/QuotaAdminView.vue`
- [x] 3.3 `admin/QuotaAdminDetailView.vue`
- [x] 3.6 `admin/ApprovalConfigView.vue` — already compliant; no change needed.

## 4. Verify

- [x] 4.1 Re-run the line-position check and confirm every single-list view now has the
  toolbar above the card (toolbar line < card line).
- [x] 4.2 Run the per-view smoke tests and confirm they still pass. All edited views mount
  cleanly (smoke: 38/39 pass; the sole failure `renders login` is a pre-existing RouterLink
  stub issue in `LoginView`, untouched by this change). The other 3 failing tests
  (`documents/LineItemsEditor`, `components.spec` field mapping) are also pre-existing and
  unrelated to the toolbar move.
- [x] 4.3 Run `vue-tsc -b` and confirm no new type errors. The only error
  (`documents/LineItemsEditor.vue:109`) is pre-existing in an untouched file; no edited view
  reports a type error.
- [ ] 4.4 Spot-check two edited pages in light and dark mode to confirm the toolbar renders
  above the card with correct theme-token surfaces and spacing. (Manual visual check — pending
  a running app; structure verified by the line-position check in 4.1.)

## 5. Tabbed multi-list pages (out of scope, per decision)

Left as-is: these use one card wrapping `<Tabs>` with a per-tab `PageToolbar` inside each
`TabPanel`; a single toolbar above the card cannot serve each tab's distinct search /
filters / actions. The spec's List Page Toolbar requirement permits a per-tab toolbar for
these. Revisit only if we later split them into per-tab canonical list layouts.

- [x] 5.1 `master/MasterDataView.vue` — skipped (tabbed: vendors / items).
- [x] 5.2 `admin/RbacAdminView.vue` — skipped (tabbed: roles / users).
- [x] 5.3 `admin/CurrencyAdminView.vue` — skipped (tabbed: currencies / rates).

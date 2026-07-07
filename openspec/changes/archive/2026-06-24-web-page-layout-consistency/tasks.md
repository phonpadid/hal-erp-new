## 1. Content region: one full-width seam

- [x] 1.1 Confirm `.layout-main` / `.layout-main-container` in `front-end/src/styles/layout/_main.scss` is the single content region (keep the `2rem` horizontal padding); ensure no `max-width` cap so in-app pages are full-width.
- [x] 1.2 Verify `AppLayout.vue` wraps `<router-view/>` only in `.layout-main` (no extra width wrapper); leave public pages (`LoginView`, `SelectCompanyView`) untouched.

## 2. Shared kit: panel-backed sections

- [x] 2.1 Re-back `front-end/src/components/SectionCard.vue` with PrimeVue `Panel` (title → panel header, `#actions` → header icons region, body → default slot) while keeping its current props/slots so callers don't change. Theme tokens only.
- [x] 2.2 Spot-check `DetailHeader.vue` and the dashboard widgets render correctly inside the full-width region with the panel-backed sections.

## 3. Remove per-view width + apply panel components (as appropriate)

- [x] 3.1 Lists — remove `max-w-* mx-auto` and group content via `Panel`/`Divider`/`ScrollPanel` where it improves grouping: `MyDocumentsView`, `BudgetListView`, `QuotaListView`, `ApprovalInboxView`, `MasterDataView`, `NotificationInboxView`.
- [x] 3.2 Details — remove width wrapper; use `SectionCard`/`Panel` for sections, `Accordion` for collapsible/secondary groups (e.g. approval history), `Divider` inside summary grids: `DocumentDetailView`, `BudgetDetailView`, `QuotaDetailView`.
- [x] 3.3 Forms — remove width wrapper; group fields with `Fieldset`, keep the inner field column constrained: `CreateDocumentView`, `CompanyFormView`.
- [x] 3.4 Admin/config — remove `max-w-* mx-auto`; group config blocks with `Panel`/`Fieldset`/`Accordion` as appropriate: `RbacAdminView`, `DocConfigView`, `OrgAdminView`, `CurrencyAdminView`, `ApprovalConfigView`.
- [x] 3.5 Dashboard — remove `max-w-7xl mx-auto`; keep widget grid, ensure standalone tiles use `Card` and the no-widgets state uses a panel, not bare `<p>`.

## 4. i18n, theming, tests

- [x] 4.1 Any new visible labels/headers added to panels come from i18n with en + la parity (no hardcoded strings).
- [x] 4.2 Confirm no hardcoded colors were introduced; all surfaces/borders use PrimeUI theme tokens and render correctly in dark mode.
- [x] 4.3 Update/extend `front-end/src/components/components.spec.ts` for the panel-backed `SectionCard` (renders title, actions slot, body) and run `pnpm test`.
- [x] 4.4 Manual check: navigate dashboard → a list → a detail → a form and confirm identical full-width gutters across all four, in both light and dark mode.

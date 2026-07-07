## 1. i18n foundation

- [x] 1.1 Restructure `front-end/src/i18n` into per-locale catalogs `locales/la.ts` and `locales/en.ts` with nested namespaces (`common`, `nav`, `topbar`, `auth`, `documents`, `approvals`, `budgets`, `quota`, `master`, `admin`, `notifications`, `dashboard`, `validation`); `index.ts` imports them, keeping `locale: 'la'` / `fallbackLocale: 'en'`.
- [x] 1.2 Migrate the existing nav/topbar keys into the new structure and fix the corrupted Lao strings.
- [x] 1.3 Add `numberFormats`/`datetimeFormats` per locale and a `useFormat()` composable for dates/counts; route money formatting through the existing currency `decimal_places` helper (never a JS number).
- [x] 1.4 Add a unit test asserting the `la` and `en` catalog key sets are identical (parity).

## 2. Shared sakai page layout

- [x] 2.1 Add a `PageHeader` component (title + optional action slot) and document the `card` container convention using PrimeUI tokens (no hardcoded colors, dark-mode safe).
- [x] 2.2 Verify topbar locale switch + configurator still apply locale live and auto-save (no regression from the catalog restructure).

## 3. Localize + restyle views by area

- [x] 3.1 Auth & company: `LoginView`, `SelectCompanyView`, `CompanyFormView` — externalize strings, apply page layout.
- [x] 3.2 Documents: `MyDocumentsView`, `CreateDocumentView`, `DocumentDetailView` — externalize strings (incl. form labels + Zod validation messages), table headers, status tags; apply page layout.
- [x] 3.3 Approvals: `ApprovalInboxView` — externalize strings, status/action labels; apply page layout.
- [x] 3.4 Budgets: `BudgetListView`, `BudgetDetailView` — externalize table headers/status; money via `decimal_places`; apply page layout.
- [x] 3.5 Quota: `QuotaListView`, `QuotaDetailView` — externalize strings; apply page layout.
- [x] 3.6 Master data: `MasterDataView` — externalize strings; apply page layout.
- [x] 3.7 Admin: `OrgAdminView`, `RbacAdminView`, `DocConfigView`, `ApprovalConfigView`, `CurrencyAdminView` — externalize strings; apply page layout.
- [x] 3.8 Notifications: `NotificationInboxView` and `NotificationBell` — externalize strings; apply page layout.
- [x] 3.9 Externalize strings in remaining shared components (dialogs, toasts, empty states).

## 4. Home Dashboard

- [x] 4.1 Create `DashboardView.vue` using the shared page layout and `dashboard.*` i18n keys.
- [x] 4.2 Build stat-card + chart widget components under `components/dashboard/`, each gated by its feature permission code (reuse the existing `v-can`/permission helper) and reading only active-company endpoints; each widget has its own loading/empty/error state.
- [x] 4.3 Point the `/` (`home`) route at `DashboardView`; keep its `DOC_VIEW`-style guard appropriate to the landing page.

## 5. Guards & verification

- [x] 5.1 Add a lint rule or test flagging non-whitespace literal display text in view templates (with an `i18n-ignore` escape hatch for codes/symbols).
- [x] 5.2 Manually verify locale switch (la↔en) re-renders all pages live and persists across sign-in; verify light/dark mode on every page.
- [x] 5.3 Run the front-end unit tests and typecheck; confirm catalog-parity and template-literal tests pass.

## 1. Shared helpers

- [x] 1.1 Create `front-end/src/views/admin/org/orgForm.ts` exporting `toYmd(date)` (local-date →
      `YYYY-MM-DD`, no UTC shift) and `fieldErrors(issues)` (first Zod issue per top-level field),
      lifted verbatim from `OrgAdminView.vue`.

## 2. Split the four tab panels into routed views (extract verbatim)

- [x] 2.1 `views/admin/org/CompaniesView.vue` — company table + filters + create/edit dialog
      (`companyCreateSchema`), `PageHeader` titled from the companies label; `onMounted` →
      `org.loadCompanies()`; permission-gated actions unchanged.
- [x] 2.2 `views/admin/org/DepartmentsView.vue` — department `TreeTable` + search + create/edit dialog
      (`departmentSchema`) including the `visibleDepartments` filter, tree builder, and the
      parent-cycle exclusion guard, all unchanged; loads departments (and the company list it uses).
- [x] 2.3 `views/admin/org/FiscalYearsView.vue` — fiscal-year table + create dialog
      (`fiscalYearSchema`) with the local-`Date`→schema conversion via `orgForm` helpers;
      `org.loadFiscalYears()`.
- [x] 2.4 `views/admin/org/HolidaysView.vue` — holiday table + create dialog (`holidaySchema`) using
      the `orgForm` helpers; `org.loadHolidays()`.
- [x] 2.5 Delete `views/admin/OrgAdminView.vue` (tabs removed).

## 3. Routing

- [x] 3.1 In `router/index.ts`, add four child routes under `AppLayout`: `org-admin/companies`
      (name `org-companies`), `org-admin/departments`, `org-admin/fiscal-years`, `org-admin/holidays`,
      each `meta: { permission: 'COMPANY_VIEW' }`.
- [x] 3.2 Replace the old `org-admin` route with `{ path: 'org-admin', redirect: { name: 'org-companies' } }`;
      remove the `OrgAdminView` import.

## 4. Sidebar

- [x] 4.1 Add `"organization"` to `NAV_SECTIONS` (after `administration`).
- [x] 4.2 Replace the single `organization` NAV entry with four entries (`orgCompanies`,
      `orgDepartments`, `orgFiscalYears`, `orgHolidays`), each `permission: 'COMPANY_VIEW'`,
      `section: 'organization'`, with distinct PrimeIcons.

## 5. i18n (en + la, key-complete)

- [x] 5.1 Add `nav.sections.organization` and `nav.orgCompanies/orgDepartments/orgFiscalYears/orgHolidays`
      to both locales (remove the now-unused single `nav.organization` if nothing else references it).
- [x] 5.2 Provide page titles (reuse `admin.org.tabs.*` or add `admin.org.pages.*`) in both locales;
      keep all in-page `admin.org.*` strings intact.

## 6. Verification

- [x] 6.1 `vue-tsc` clean; i18n parity test passes (en/la complete).
- [x] 6.2 Each page renders, loads its own data, and its create/edit dialog validates against the
      shared schema and scopes to the active company (departments parent-cycle guard still excludes a
      node + its descendants).
- [x] 6.3 Sidebar shows the Organization group with four entries only when the user holds
      `COMPANY_VIEW`; `/org-admin` redirects to Companies; no dead references to `OrgAdminView`.

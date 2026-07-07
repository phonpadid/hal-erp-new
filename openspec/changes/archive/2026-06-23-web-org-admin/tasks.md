## 1. Shared schemas

- [x] 1.1 In `@erp/shared` (reuse existing `companyCreateSchema`): add `departmentSchema` (deptCode, name, parentDeptId?, costCenter?), `fiscalYearSchema` (year int 2000–2100, startDate, endDate ISO strings), `holidaySchema` (holidayDate, name); export inferred types. `pnpm --filter @erp/shared build`.

## 2. Frontend data layer

- [x] 2.1 `api/org.ts`: namespaces — companies (list/create/update), departments (list/create/update), fiscalYears (list/create/update/close), holidays (list/create/remove); plus a currencies list helper (`GET /currencies`).
- [x] 2.2 `stores/org.ts` (Pinia): `companies`, `departments`, `fiscalYears`, `holidays`, `currencies`, `loading`, `error`; `loadAll()` + per-entity loaders; mutation wrappers that refresh after success; capture errors.

## 3. View & shell

- [x] 3.1 `views/admin/OrgAdminView.vue` with `Tabs`: Companies (table + create/edit dialog, base-currency Select), Departments (table + create/edit dialog with parent Select + active toggle), Fiscal Years (table with status + create/edit dialog + Close button with confirm), Holidays (table + Add dialog + per-row delete). Manage controls gated by the relevant `*_MANAGE` code.
- [x] 3.2 Dialogs use `<Form :resolver="zodResolver(schema)">` + `<FormField>` + `<Message>` with the shared schemas (companyCreateSchema / departmentSchema / fiscalYearSchema / holidaySchema).
- [x] 3.3 Routing + nav: route `org-admin` (`meta.permission='COMPANY_VIEW'`); an "Organization" nav item gated by `can('COMPANY_VIEW')`.

## 4. Frontend tests

- [x] 4.1 org store (mock `api`): loaders populate companies/departments/fiscalYears/holidays; `createDepartment`/`createFiscalYear`/`closeFiscalYear`/`removeHoliday` call the right endpoint and refresh; error captured.
- [x] 4.2 Shared schemas: valid company/department/fiscal-year/holiday accepted; missing required and an out-of-range fiscal year rejected.

## 5. Verify

- [x] 5.1 `pnpm --filter @erp/shared build`, `pnpm --filter front-end build` + `pnpm --filter front-end test`, and `pnpm --filter back build` pass.
- [x] 5.2 Run `openspec validate web-org-admin --type change --strict`.

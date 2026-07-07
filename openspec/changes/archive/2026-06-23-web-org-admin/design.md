## Context

The multi-company backend is complete: `/companies` (CRUD + `mine`), `/departments` (CRUD),
`/fiscal-years` (create/list/get/patch + `:id/close`), `/holidays` (create/list/get/delete), each
guarded by `COMPANY_*` / `DEPARTMENT_*` / `FISCAL_YEAR_MANAGE` / `HOLIDAY_MANAGE`. Company create
already reuses the shared `companyCreateSchema` (one source of truth with the UI). Departments,
fiscal years, and holidays are active-company scoped server-side. The Vue shell + prior admin
slices give `can()`, the typed-api/store pattern, `@primevue/forms` + `zodResolver`, and the
`@erp/shared` package. DTO shapes: department (deptCode, name, parentDeptId?, costCenter?);
fiscal year (year, startDate, endDate); holiday (holidayDate, name); company edit (nameTh, nameEn,
taxId, branchCode, baseCurrency, isActive).

## Goals / Non-Goals

**Goals**
- Vue organization admin: Companies · Departments · Fiscal Years · Holidays, gated per permission
  code, forms validated against shared Zod schemas, fiscal-year close action.
- Tests: org store + shared schemas.

**Non-Goals**
- The active-company switcher (already in topbar), currency/FX admin, org-chart UI, period reopen.

## Decisions

### D1 — Shared Zod schemas
Reuse the existing `companyCreateSchema`. Add `departmentSchema` (deptCode, name, parentDeptId?,
costCenter?), `fiscalYearSchema` (year int 2000–2100, startDate, endDate), `holidaySchema`
(holidayDate, name) to `@erp/shared`, mirroring the DTOs so the create forms validate identically
(CLAUDE.md parity). Dates are ISO `yyyy-mm-dd` strings.

### D2 — Frontend data layer
`api/org.ts` with four namespaces: companies (list/create/update), departments (list/create/
update), fiscalYears (list/create/update/close), holidays (list/create/remove). `stores/org.ts`
(Pinia): `companies`, `departments`, `fiscalYears`, `holidays`, `currencies` (for the base-currency
select), `loading`, `error`; `loadAll()` + per-entity loaders; mutation wrappers that refresh;
capture errors. Currencies come from the existing `GET /currencies`.

### D3 — Tabbed Organization view
`views/admin/OrgAdminView.vue` with PrimeVue `Tabs`:
- **Companies**: table + create/edit dialog (`companyCreateSchema` for create; the edit dialog
  edits the mutable fields). Base currency is a `Select` of existing currency codes.
- **Departments**: table (active company) + create/edit dialog; parent is a `Select` of the
  company's departments; an "Active" toggle drives deactivate via update.
- **Fiscal Years**: table (year, start, end, status) + create/edit dialog + a "Close" button
  (with confirm) calling `:id/close`.
- **Holidays**: table (date, name) + "Add holiday" dialog + per-row delete.
Each tab's manage controls gated by the relevant `*_MANAGE` code; dialogs use `<Form :resolver>` +
`<FormField>` + `<Message>`.

### D4 — Routing & nav
Route `org-admin` (`meta.permission='COMPANY_VIEW'`); an "Organization" nav item gated by
`can('COMPANY_VIEW')`. Admin (all codes) sees it; a finer-grained user sees the tabs/actions their
codes allow. (Departments/fiscal/holiday tabs render for everyone with COMPANY_VIEW; their write
controls are individually gated — consistent with the other admin screens.)

### D5 — Tests
- Frontend (Vitest): org store with a mocked api (loaders populate; create/update/close/remove
  call the right endpoint and refresh; error captured) + shared-schema validation (valid/invalid
  department, fiscal year — bad year range — and holiday).

## Risks / Trade-offs

- **Company directory scope** — `/companies` lists companies the user may view (not active-company
  scoped); that's the existing backend contract. The admin manages records here; switching the
  session company stays in the topbar. No isolation change.
- **Fiscal-year close is one-way** in this slice (no reopen) — matches the backend. A confirm
  dialog guards the action.
- **Date inputs** — native date inputs producing `yyyy-mm-dd` strings; no timezone math (dates are
  plain calendar dates server-side).

## Migration Plan

`shared`: add the three schemas; build. Frontend: add `api/org.ts`, `stores/org.ts`,
`OrgAdminView.vue`, router/nav, tests. `pnpm --filter @erp/shared build`, `pnpm --filter front-end
build/test`. Backend untouched. Validate `openspec validate web-org-admin --type change --strict`.
Rollback = revert the `front-end/` + `shared/` additions.

## Open Questions

- Show inactive companies/departments? Default: list all with an active flag/toggle; no separate
  filter this slice.
- Base-currency select vs free text? Default: a `Select` of existing currency codes (from
  `/currencies`), falling back to a text input if the list is empty.

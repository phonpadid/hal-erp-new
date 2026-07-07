## Why

Companies, departments, fiscal years, and holidays are the org structure every other screen
hangs off — documents belong to a department, budgets to a fiscal year, working-day math to the
holiday calendar, and submit is blocked outside an OPEN period (`assertOpenPeriod`). Today all of
this exists only via the seed; there's no UI to add a department, open/close a fiscal period, or
maintain holidays. This change adds the organization admin so an admin can manage the structure
without re-seeding.

The multi-company backend is already complete (companies/departments/fiscal-years/holidays all
have CRUD + list/get, fiscal years have a `close` action), so this is a frontend-only change.

## What Changes

- **New capability `web-org-admin`** — the organization admin in the Vue shell, a tabbed area:
  Companies · Departments · Fiscal Years · Holidays.
- **Companies** (`COMPANY_VIEW` / `COMPANY_MANAGE`): list, create (shared `companyCreateSchema`),
  and edit (name TH/EN, tax id, branch, base currency, active).
- **Departments** (`DEPARTMENT_VIEW` / `DEPARTMENT_MANAGE`): the active company's departments —
  list, create (code, name, optional parent/cost-center), edit, deactivate.
- **Fiscal Years & period control** (`FISCAL_YEAR_MANAGE`): list, create (year + start/end),
  edit dates, and **close** a fiscal year — the open/close that gates document submit.
- **Holidays** (`HOLIDAY_MANAGE`): the active company's holiday calendar — list, add (date +
  name), delete.
- **Shell integration**: an "Organization" nav entry (gated by `COMPANY_VIEW`); a typed
  `api/org.ts` + a Pinia store; all create/edit forms use `@primevue/forms` + `zodResolver` with
  schemas shared in `@erp/shared` (reusing the existing `companyCreateSchema`).
- **Tests**: frontend unit tests for the org store and the shared schemas (no backend tests —
  no backend change).

## Capabilities

### New Capabilities
- `web-org-admin`: the Vue organization admin — manage companies, departments, fiscal years
  (incl. period close), and holidays, permission-gated and company-scoped.

## Impact

- **Affected**: `front-end/` (tabbed view, store, api, router/nav) and `shared/` (Zod schemas for
  department / fiscal year / holiday).
- **Invariants reflected**: 5 (each area gated by its permission code; server enforces); 1
  (departments/fiscal-years/holidays scoped to the active company; the company directory is
  cross-company read per existing rules); validation parity (shared Zod schema).
- **Consumes**: existing `/companies`, `/departments`, `/fiscal-years` (+ `:id/close`),
  `/holidays` CRUD + list/get. No new endpoint, no schema change, no new dependency.

## Out of Scope

- The active-company switcher itself (already in the topbar) — this manages the company records,
  not the session's active company.
- Currency + exchange-rate management — `web-currency-admin` (base-currency here is a plain
  3-letter input/select of existing currencies).
- Department hierarchy drag-and-drop / org chart — parent is a plain select this slice.
- Fiscal-period reopen and multi-period locking beyond the existing single `close` action.

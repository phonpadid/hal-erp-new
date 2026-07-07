## Context

The scaffold (`platform-foundation`) already provides the four entities
(`company`, `department`, `fiscal_year`, `holiday_calendar`), the company-scope filter
on `CompanyScopedEntity`, `CompanyScopeService.forActiveCompany()`, the JWT
`RequestContext`, and the `@RequirePermissions` / `PermissionsGuard` pair. What's
missing is the behavior: modules, services, controllers, DTOs, and tests. This change
adds only that — there is no schema change, so no new migration.

`company` is the root entity and is **not** `CompanyScopedEntity` (it has no
`company_id`); the other three are company-scoped and flow through the scope filter.

## Goals / Non-Goals

**Goals:**
- A `MultiCompanyModule` with REST CRUD for the four resources, each guarded by a
  permission code and (for company-owned resources) the active-company scope.
- Enforce the invariants the spec calls out: deactivate-not-delete, same-company &
  acyclic department parents, fiscal-year close + closed-period guard, base-currency
  validity.
- A reusable `WorkingTimeService` (skip weekends + `holiday_calendar`) and an
  `assertOpenPeriod` guard that later capabilities (budget, document) consume.
- Tests for every rule above, including company-scope isolation.

**Non-Goals:**
- Per-user company membership and the company switcher — that needs `user_company_role`
  from the **rbac** slice. Here, company management is gated purely by `COMPANY_MANAGE`.
- Seeding/CRUD of `permission` rows and role→permission resolution (rbac).
- Any budget/quota/document/workflow behavior; the closed-period guard is provided but
  only self-tested, not yet wired into document submission.
- Carry-forward of fiscal years or holidays.

## Decisions

### D1 — Company endpoints are permission-gated; company-owned endpoints are also scoped
`company` CRUD is authorized by `COMPANY_MANAGE` (writes) / `COMPANY_VIEW` (reads) with
no row filter, since cross-company membership isn't modeled until rbac. `department`,
`fiscal_year`, and `holiday_calendar` go through `CompanyScopeService.forActiveCompany()`
so reads/writes are bound to the JWT's active `companyId`; a write whose target resolves
to another company is rejected. *Alternative considered:* filter companies by the
caller's memberships now — rejected, that data lives in `user_company_role` (rbac).

### D2 — Deactivate, never delete
DELETE on a company sets `is_active = false`. Lists exclude inactive rows unless an
explicit `includeInactive` query flag is set; get-by-id still returns them. This keeps
referential history intact (invariant: append-only spirit) and is the spec's
"Company Deactivation" requirement. The same soft pattern applies to department/holiday
removal via `is_active` where the column exists; `holiday_calendar` has no `is_active`,
so holidays are hard-deletable (they carry no downstream references).

### D3 — Department parent validation: same-company + acyclic
On create/reparent: (a) load the proposed parent through the company-scoped EM so a
cross-company parent simply isn't found → reject; (b) walk the ancestor chain from the
proposed parent up via `parent_dept_id`; if we reach the department being edited, the
edit would create a cycle → reject. The walk is bounded by the number of departments,
so a corrupt pre-existing cycle can't loop forever (visited-set guard).

### D4 — Fiscal year close is a guarded state transition; period guard is a query
`close(id)` loads the year (scoped), rejects if already `CLOSED`, else sets `CLOSED`.
`assertOpenPeriod(date, companyId?)` finds the fiscal year of the active company whose
`start_date <= date <= end_date`; if none, or if it is `CLOSED`, it throws a
closed-period error. No ledger writes, so no `em.transactional()` / lock needed here
(those are reserved for `budget_txn` / `quota_usage` / `doc_running_number`).

### D5 — Working-time SLA helper
`WorkingTimeService.addWorkingHours(start, hours, companyId)` advances an instant by N
working hours, counting only Mon–Fri and skipping dates present in `holiday_calendar`
for that company. Holidays are loaded once into a `Set<'YYYY-MM-DD'>` for the span.
Working day is treated as a full 24h working block for the scaffold's purposes (the
business-hours window can be refined when approval-workflow lands); the spec scenario
only requires that weekends and holidays are excluded from the countdown.

### D6 — DTOs: class-validator, with the company-create schema shared via Zod
Each write endpoint has a class-validator DTO; UUID path params use `ParseUUIDPipe`.
The company-create payload reuses `companyCreateSchema` from `@erp/shared` through a
`ZodValidationPipe`, so the Vue form and this endpoint validate identically (single
source of truth). Other DTOs are plain class-validator until a shared schema is worth it.

## Risks / Trade-offs

- **Company list isn't yet filtered by caller membership** → Mitigation: gate behind
  `COMPANY_MANAGE`/`COMPANY_VIEW` now; add membership filtering when rbac introduces
  `user_company_role`. Documented as a non-goal so it isn't mistaken for a gap.
- **Permission codes aren't seeded** (no `permission` rows yet) → Mitigation: the guard
  reads codes from the JWT, so tests inject tokens directly; real issuance comes with
  rbac. No runtime dependency on `permission` rows in this slice.
- **Working-hours model is coarse** (24h working days) → Mitigation: the SLA contract
  the spec tests (skip weekends + holidays) is satisfied; business-hour windows are a
  later refinement in approval-workflow, isolated behind `WorkingTimeService`.
- **Active company in context** depends on a valid JWT → unauthenticated/empty context
  makes `forActiveCompany()` throw "no active company"; controllers sit behind
  `JwtAuthGuard`, so this surfaces as 401 before scope is read.

## Migration Plan

No database migration — entities are unchanged. Steps: add module + services +
controllers + DTOs; register in `AppModule`; add tests; run `pnpm test`. Rollback is
reverting the module (no data/schema impact).

## Open Questions

- Should `COMPANY_VIEW` list be implicitly restricted to the caller's companies now via
  a temporary claim, or strictly deferred to rbac? Default: defer to rbac; list all for
  `COMPANY_VIEW` holders in this slice.
- Do holidays need bulk import (CSV) in this slice? Default: no — single-row CRUD only;
  bulk import can be a later additive change.

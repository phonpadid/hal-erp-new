## Context

The scaffold provides `quota` (company-scoped), `quota_usage`, `quota_entitlement` and
the seams (`inTransaction`/`lockForUpdate`, `Money`, company filter). budget-control is
implemented and is the template to mirror. `quota_usage.document_id` is NOT NULL, so
tests seed a minimal document graph (as budget-control does). `quota_usage` is **not**
append-only in the DBML, so the LedgerGuard does not apply to it. No schema change.

## Goals / Non-Goals

**Goals**
- Quota CRUD (company-scoped, deactivate-not-delete) and entitlement CRUD + rollover.
- Derived remaining (personal via entitlement, quota-level via `limit_value`).
- `reserve` / `releaseAll` with locking + over-quota enforcement; unit + concurrency tests.
- Deliver the engine for document-engine (HR leave/OT flows).

**Non-Goals**
- Document submit/reject that trigger reserve/release (document-engine).
- Scheduled period-reset jobs — rollover is an on-demand operation.
- A money-budget bridge (money quotas exist but are still counted as quota units here).

## Decisions

### D1 — Two remaining contexts, selected by whether an employee is given
- **Personal** (employee provided): `remaining = entitled + carried_over + adjusted
  − netUsage(quota, employee)`, where the entitlement is `(quota, employee, year)`.
- **Quota-level** (no employee): `remaining = limit_value − netUsage(quota)`.
`netUsage = Σ qty_used[USE] − Σ qty_used[RELEASE]` over `quota_usage` (filtered by
employee for the personal path). `reserve` picks the path from whether `employeeId` is
supplied. *Alternative considered:* infer personal-vs-level from the quota row — rejected,
the same quota could be queried both ways; the caller's intent (employee or not) decides.

### D2 — Reserve: lock, check remaining, insert USE (one transaction)
`reserve({ documentId, quotaId, employeeId?, qty, year? })` in `inTransaction`:
1. `lockForUpdate(Quota, {id})` (company filter disabled — see D5); for the personal path
   also `lockForUpdate(QuotaEntitlement, {quota, employee, year})`.
2. compute remaining inside the txn; if `qty > remaining` → `BadRequestException`
   (over-quota; quota is always enforced for an active quota).
3. insert a USE `quota_usage` (qty, employee?, document).
The lock serializes concurrent reservations so the last-unit race resolves to one winner
(the second sees the first's USE after the lock and fails).

### D3 — Outstanding USE drives auto-release (invariant 4/5)
`outstandingUsage(documentId, quotaId, employeeId?, em)` = `Σ USE − Σ RELEASE` for that
document+quota(+employee). `releaseAll(documentId)`: for each (quota[,employee]) the
document used, insert a RELEASE of the outstanding (never more than was used; idempotent
when 0). There is no ACTUAL step — quota is reserve→release only (USE stands as the
committed consumption; reject/cancel releases it).

### D4 — Carry-forward rollover
`rollover({ quotaId, employeeId, fromYear, toYear, entitledValue })`: compute the prior
year's remaining and create/update the `toYear` entitlement with `carried_over = prior
remaining` and the given `entitled_value`. `reset_cycle` informs when this is run, but
*whether* to carry forward is the admin's call (no carry-forward flag column in the DBML).

### D5 — Company-filter handling
`quota` is company-scoped → reads/writes go through `CompanyScopeService.forActiveCompany()`.
`quota_usage` / `quota_entitlement` are not company-scoped but relate to scoped entities
(`quota`, `employee`), so the global `company` filter auto-joins; ledger reads pass
`{ filters: { company: false } }` (same pattern budget-control needed), with company
isolation still guaranteed because every usage/entitlement hangs off a quota that was
resolved within the active company.

### D6 — DTOs / endpoints
- `quotas`: CRUD (`quotaType`, `unit`, `limitValue` `@IsNumberString`, `resetCycle?`,
  `departmentId?`); `GET /quotas/:id/remaining?employeeId&year`.
- `quota-entitlements`: create/update + `POST /quota-entitlements/rollover`.
- Reserve/release are service-to-service (document-engine); a thin manual endpoint is
  optional. `ParseUUIDPipe` on ids; quantities are strings.

## Risks / Trade-offs

- **`quota_usage` has no period/year column** → usage is cumulative per (quota, employee);
  the year dimension lives only on entitlement. Personal remaining assumes usage belongs
  to the entitlement's active period. Documented; a cleaner model would add a period to
  usage, which is a schema change out of scope here. Tests operate within one year.
- **Quota always enforced** (no SOFT_WARNING analogue) → matches the spec ("MUST block …
  when the quota is enforced"); a soft mode can be added later if a quota needs it.
- **Deadlocks** when locking quota + entitlement → always lock quota first, then
  entitlement (deterministic order).

## Migration Plan

No DB migration. Steps: build `QuotaManagementModule` (services, controllers, DTOs,
permission constants); register in `AppModule`; add unit + concurrency tests; `pnpm
build` + `pnpm test`. Rollback = revert the module.

## Open Questions

- Should reserve validate the employee belongs to the active company / the quota's
  department? Default: document-engine resolves the employee in context; quota-management
  trusts the supplied employeeId. Revisit when document-engine wires HR flows.

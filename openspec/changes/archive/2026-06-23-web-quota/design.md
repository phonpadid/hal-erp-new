## Context

quota-management mirrors budget-control but with an employee dimension.
`QuotaBalanceService` already has `netUsage(quotaId, employeeId?)` (Σ USE − Σ RELEASE),
`entitlementTotal(quotaId, employeeId, year)` (entitledValue + carriedOver + adjusted), and
`remaining(quotaId, { employeeId, year })`. `QuotaService.list()/get()` are **already
company-scoped** (`scope.forActiveCompany()`) — unlike budget, no isolation fix is needed.
`GET /quotas`, `/quotas/:id`, `/quotas/:id/remaining` exist (`QUOTA_VIEW`). A `Quota` is either a
pool (`limitValue`, optional department) or entitlement-based (`quota_entitlement` per
employee/year); `quota_usage` rows are `{ quota, document, employee?, qtyUsed, usageType, createdAt }`.
The Vue shell + `web-budgets` give `can()`, the typed-api/store pattern, and `formatAmount`.
Missing for a screen: a component breakdown and a usage-ledger read.

## Goals / Non-Goals

**Goals**
- A `QUOTA_VIEW` breakdown read (pool + per-employee entitlements that reconcile) and a usage
  ledger read, both company-scoped.
- Vue quota list + detail (pool card, entitlements table, usage ledger), gated by `QUOTA_VIEW`,
  quantities formatted by `formatAmount`.
- Tests: breakdown math (pool + per-employee), usage read; frontend store + a derivation helper.

**Non-Goals**
- Quota/entitlement/rollover write screens (`QUOTA_MANAGE`), a requester "my balance" view,
  changing the `/remaining` contract.

## Decisions

### D1 — Breakdown computed from usage + entitlements (reuse existing math)
Add `QuotaBalanceService.breakdown(quotaId)`:
- pool: `{ limit: quota.limitValue, used: netUsage(quotaId), remaining: limit − used }`.
- entitlements: for each `quota_entitlement` of the quota, `{ employeeId, employeeName,
  year, entitled: entitledValue+carriedOver+adjusted, used: netUsage(quotaId, employeeId),
  remaining: entitled − used }` (reuses `netUsage`/`entitlementTotal`, so figures match
  `remaining()` exactly). Returns quota meta (type, unit, resetCycle, departmentName) too.
*Alternative:* a single SQL aggregate — rejected; the in-memory fold reuses the canonical Money
math and avoids drift, same call the controller's `remaining` already trusts.

### D2 — Usage ledger read
`QuotaBalanceService.usageLedger(quotaId)` → `quota_usage` for the quota, `orderBy createdAt
DESC`, returning `{ id, usageType, qtyUsed, employeeName, documentId, documentNo, createdAt }`.
Resolve employee/document names with a small batched lookup by id (the pattern used in the budget
ledger read), avoiding per-row relation loads. Read-only (invariant 2).

### D3 — Company scoping via the existing scoped get
Both new reads are gated in the controller by first calling `await this.quotas.get(id)` (which
`scope.forActiveCompany()` already enforces — throws NotFound for another company's quota), then
delegating to the balance service by id. No new scope logic in the balance service. Routes:
`GET /quotas/:id/breakdown` and `GET /quotas/:id/usage`, both `QUOTA_VIEW`, after
`/:id/remaining`.

### D4 — Frontend data layer
`api/quotas.ts`: `list()`, `get(id)`, `breakdown(id)`, `usage(id)` (quantities as strings).
`stores/quota.ts` (Pinia): `list`, `current`, `breakdown`, `usage`, `loading`, `error`;
`loadList()` (with pool remaining per row from `breakdown`, demo scale — documented), `loadOne(id)`
(get + breakdown + usage). Reuse `utils/money.formatAmount` for unit quantities.

### D5 — Views, routing, nav
- `views/quota/QuotaListView.vue`: DataTable (type, unit, department, limit, remaining, reset
  cycle), row → detail; empty + error states.
- `views/quota/QuotaDetailView.vue`: a pool card (limit − used = remaining); an entitlements
  DataTable (employee, year, entitled, used, remaining) shown when entitlements exist; the usage
  DataTable with `documentNo` linking to `document-detail`.
- Route `quota` (`meta.permission='QUOTA_VIEW'`) + `quota/:id`; a "Quota" nav item gated by
  `can('QUOTA_VIEW')`. In the seed only `admin` holds `QUOTA_VIEW`, so the entry shows for admin
  (sufficient to demo; a requester self-service grant is out of scope).

### D6 — Tests
- Backend (DB-backed, reuse `seedDatabase`): the seeded ANNUAL_LEAVE quota has an entitlement
  (requester, 12). `breakdown` returns that entitlement with `entitled = 12`, `used = 0`,
  `remaining = 12`; after inserting a `quota_usage` USE of 2 against a document, the employee's
  `used = 2`, `remaining = 10`, and `usageLedger` returns the row with its document; a quota in a
  second company is not readable when company A is active (via `quotas.get`).
- Frontend (Vitest): quota store with a mocked api (`loadOne` sets current/breakdown/usage;
  `loadList` populates with remaining; error captured) and a pure `deriveRemaining(entitled, used)`
  helper.

## Risks / Trade-offs

- **N+1 on the list** (a breakdown per quota for pool remaining) — trivial at demo scale; revisit
  with an aggregate if quota counts grow. Logged as a known simplification.
- **Employee/document name lookups** in the ledger — batched by id; fine at demo scale.
- **Two quota modes in one detail view** — show the pool card always and the entitlements table
  only when entitlements exist, so both limit-based and entitlement-based quotas render sensibly.

## Migration Plan

Backend: add `breakdown` + `usageLedger` and the two `QUOTA_VIEW` reads; `pnpm --filter back
build/test`. Frontend: add `api/quotas.ts`, `stores/quota.ts`, the two views, router/nav, tests;
`pnpm --filter front-end build/test`. Validate `openspec validate web-quota --type change
--strict`. Rollback = revert the quota read additions and the `front-end/` additions.

## Open Questions

- Show all entitlement years or just the current reset cycle? Default: all years returned; the
  detail shows a year column (the demo has only the current year).
- Surface a per-employee usage filter on the ledger? Default: no for this slice (show all, newest
  first); add a filter when inboxes grow.

## Context

`BudgetBalanceService` methods are dual-use: called standalone from the controller
(`/budgets/:id/balance|breakdown|ledger`) AND from `BudgetLedgerService` inside
`em.transactional(tem => ...)`. They express this with an optional trailing param
`em: EntityManager = this.em`. The default `this.em` is the injected (global) EntityManager;
using its `find/findOne` outside an active MikroORM request context throws
`ValidationError: Using global EntityManager instance methods ... is disallowed` → 500.
`BudgetService.list/get` call `this.em.find/findOne` directly with the same flaw.
`QuotaBalanceService` mirrors the budget pattern. Sibling read services already fork
(`this.em.fork()`), which is the intended pattern. Reproduced: `breakdown` throws via the global
EM and succeeds via a fork (confirmed against the real `new_erp` DB).

## Goals / Non-Goals

**Goals**
- The read endpoints never throw the global-context error: fork when no caller `em` is supplied.
- Transactional callers keep using their `em` (atomicity preserved).
- A regression test that fails on the old code and passes on the fixed code.

**Non-Goals**
- No change to balance math, ledger shape, endpoint contracts, or other modules.

## Decisions

### D1 — Fork when no transactional `em` is passed
Change the dual-use signatures from `em: EntityManager = this.em` to `em?: EntityManager`, and at
the top resolve `const m = em ?? this.em.fork();`, then use `m` throughout. Effect: the
controller path (no arg) gets a fresh fork (valid context, no global-EM error); transactional
callers pass `tem` and are unaffected. Apply to:
- `BudgetBalanceService`: `availableBalance`, `outstandingReserved`, `breakdown`, `usageLedger`
  (and `breakdown` passes its `m` into the private `requireInActiveCompany`, which already takes
  an `em`).
- `QuotaBalanceService`: `netUsage`, `outstandingUsage`, `entitlementTotal`, `remaining`,
  `breakdown`, `usageLedger`.
*Alternative:* default the param to `this.em.fork()`. Rejected — `this` in a parameter default is
brittle/awkward; the explicit `em ?? this.em.fork()` is clearer and avoids surprises.

### D2 — BudgetService.list/get fork directly
`list()` → `this.em.fork().find(...)`; `get()` → `this.em.fork().findOne(...)`. These are
read-only and never part of a caller transaction. (`QuotaService.list/get` already read via
`CompanyScopeService.forActiveCompany()`, which forks — no change needed; verify during apply.)

### D3 — Regression test (locks the fix)
A DB-backed test that constructs the service with the **root** `orm.em` and calls
`breakdown`/`usageLedger` (budget) and `breakdown` (quota) **without** wrapping in a MikroORM
request context and **without** passing an `em`. Before the fix this throws the global-context
ValidationError; after, it returns the derived figures. Reuse `seedDatabase` for data; wrap in the
app's `RequestContext.run({ companyId })` so the company filter resolves. Also assert a
transactional-style call (passing an explicit `em`) still works, guarding D1's branch.

## Risks / Trade-offs

- **Extra fork per read** — negligible; forking is cheap and is already the norm for reads.
- **Signature change** `= this.em` → `?` — internal only; callers that passed an `em` are
  unchanged, callers that relied on the default now get a fork (the desired behavior).
- **Stale dev process** — a running `nest start --watch` must restart to load the fix (its old
  in-memory build is what currently 500s); noted for the user.

## Migration Plan

Edit the two budget services + quota balance service; add the regression test. Run
`pnpm --filter back build` and `pnpm --filter back test` (DB on 5433). Manually verify
`GET /budgets/:id/breakdown` returns 200 against `new_erp` on a fresh instance. Validate
`openspec validate fix-budget-quota-read-context --type change --strict`. Rollback = revert the
service edits.

## Open Questions

- None. The fix is mechanical and matches the existing fork pattern used elsewhere.

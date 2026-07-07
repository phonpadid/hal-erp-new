## Why

`GET /budgets/:id/breakdown` returns `500 Internal Server Error`. Root cause: the budget and
quota read services call the **injected (global) EntityManager directly** instead of forking a
per-call context. When MikroORM's per-request context isn't active for that call, `em.findOne`
throws *"Using global EntityManager instance methods for context specific actions is disallowed"*
→ 500. Reproduced directly: the breakdown method against the real DB throws that exact error
through the global EM, but succeeds when given a forked EM.

Sibling read services already fork (`notification.listForUser`, `workflow-config.listWorkflows`
use `this.em.fork()`); the budget/quota reads were the inconsistent ones. The same latent bug
affects `GET /budgets/:id/ledger` and the identical `GET /quotas/:id/breakdown` and
`/quotas/:id/usage`.

## What Changes

- **budget-control**: `BudgetBalanceService` (`availableBalance`, `outstandingReserved`,
  `breakdown`, `usageLedger`) and `BudgetService` (`list`, `get`) operate on a **forked**
  EntityManager when no transactional `em` is passed. Methods that take an optional `em` (used
  inside `em.transactional(...)`) still use the caller's `em` unchanged — only the no-arg
  (controller) path now forks.
- **quota-management**: the same fix for `QuotaBalanceService` (`netUsage`, `outstandingUsage`,
  `entitlementTotal`, `remaining`, `breakdown`, `usageLedger`); `QuotaService` reads already go
  through the company-scope service.
- **Tests**: a regression test per service that calls a read method on the **global** EM (no
  fork, no ambient context) and asserts it returns rather than throwing the global-context error —
  locking the fix.

## Capabilities

### Modified Capabilities
- `budget-control`: derived-balance and ledger reads are EM-context-safe (fork their own unit of
  work), so the read endpoints succeed regardless of ambient request context.
- `quota-management`: same context-safety for the quota balance/usage reads.

## Impact

- **Affected**: `back/src/modules/budget/budget-balance.service.ts`,
  `back/src/modules/budget/budget.service.ts`,
  `back/src/modules/quota/quota-balance.service.ts`, plus tests.
- **Fixes**: 500 on `GET /budgets/:id/breakdown` (reported) and the same class on
  `/budgets/:id/ledger`, `/quotas/:id/breakdown`, `/quotas/:id/usage`.
- **No behavior/algorithm change** — derived figures and append-only/derived-balance invariants
  are unchanged; only the EM context is made robust. No schema change, no API-shape change.
- **Transactional paths unchanged** — `BudgetLedgerService`/`QuotaUsageService` still pass their
  `em` into these methods, so reserve/settle stay inside their single transaction (concurrency
  rules intact).

## Out of Scope

- Any change to the balance math, ledger contents, or endpoint shapes.
- Broader EM-context auditing of other modules (siblings already fork correctly).
- The operational note that a stale `nest start --watch` process can serve old code — a restart
  picks up this fix once applied.

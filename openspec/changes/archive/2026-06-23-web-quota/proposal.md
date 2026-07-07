## Why

`web-budgets` made the budget side of the control loop visible; quota is its twin for
non-monetary limits (e.g. annual leave days). A LEAVE document reserves quota the same way a PR
reserves budget, but there's no screen to see a quota's entitlements, usage, and remaining. This
change adds the quota screens — completing the budget/quota "control" pair and making the LEAVE
document type demoable end to end.

Quota differs from budget in one way that shapes the UI: it has an **employee dimension**.
A quota is either a company/department pool (`limitValue`) or entitlement-based, where each
employee has their own entitled / carried-over / adjusted balance per year. The backend computes
remaining for both, but exposes only a single number and no usage ledger — so this change adds a
breakdown read and a usage-ledger read, then builds the Vue screens on them.

## What Changes

- **New capability `web-quota`** — the quota list + detail screens in the Vue shell.
- **Backend (quota-management delta)**:
  - `QuotaBalanceService.breakdown(quotaId)` + `GET /quotas/:id/breakdown` (`QUOTA_VIEW`) →
    the pool view (`limitValue`, net `used`, `remaining`) **and** the per-employee entitlements
    (`employeeName`, `year`, `entitled` = entitledValue + carriedOver + adjusted, net `used`,
    `remaining`), all derived from `quota_usage` / `quota_entitlement` — never a stored usage
    figure on the quota.
  - `GET /quotas/:id/usage` (`QUOTA_VIEW`) → the quota's `quota_usage` ledger (usage type, qty,
    employee, source document, timestamp), newest first — read-only.
  - Both reads are scoped to the active company by resolving the quota through the existing
    company-scoped `QuotaService.get` first.
- **Quota list** (`QUOTA_VIEW`): the active company's quotas (type, unit, department, limit,
  reset cycle) with the pool remaining; click → detail.
- **Quota detail** (`QUOTA_VIEW`): a pool card (limit − used = remaining) for limit-based
  quotas, an entitlements table (employee, entitled, used, remaining) for entitlement-based
  quotas, and the usage ledger (each row linking to its source document); amounts formatted to
  the quota's unit.
- **Shell integration**: a "Quota" nav entry (gated by `QUOTA_VIEW`); a typed `api/quotas.ts` +
  a small Pinia store; reuse of the existing `formatAmount` money helper for unit quantities.
- **Tests**: backend tests for the breakdown math (pool + per-employee) and the usage-ledger
  read; frontend unit tests for the quota store and a derivation helper.

## Capabilities

### New Capabilities
- `web-quota`: the Vue quota list and detail screens — derived pool/entitlement breakdown and
  the usage ledger, permission-gated and company-scoped.

### Modified Capabilities
- `quota-management`: adds a derived-balance **breakdown** read (pool + per-employee
  entitlements) and a **usage-ledger** read. The derived-balance and append-only usage
  invariants are unchanged; this only exposes more read detail.

## Impact

- **Affected**: `front-end/` (new views/store/api, router/nav) and `back/src/modules/quota/`
  (a `breakdown` + `usageLedger` method, two controller reads) with tests.
- **Invariants reflected**: 3 (quota remaining derived from `quota_usage`/`quota_entitlement`,
  never stored as usage); 2 (the usage-ledger read is strictly read-only); 1 (reads scoped to the
  active company via `QuotaService.get`); 5 (gated by `QUOTA_VIEW`).
- **Consumes**: existing `GET /quotas`, `GET /quotas/:id`, `GET /quotas/:id/remaining`, plus the
  new `…/breakdown` and `…/usage`.
- **No schema change**; no new dependency (`decimal.js` already present for the frontend).

## Out of Scope

- Creating / editing quotas, entitlements, and rollover from the UI (`QUOTA_MANAGE` write
  screens) — a later `web-quota-admin` slice; this change is read-only.
- A "my leave balance" self-service view for requesters (would need a `QUOTA_VIEW` grant on the
  Requester role) — the demo views quotas as `admin`.
- Changing the existing `GET /quotas/:id/remaining` contract (kept; breakdown is a new read).

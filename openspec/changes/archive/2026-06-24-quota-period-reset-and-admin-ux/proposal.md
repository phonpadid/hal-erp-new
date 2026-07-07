## Why

Quota already supports multi-unit allowances (money / days / hours / counts) at
company, department, and personal levels, auto-deducts on submit, and auto-releases on
reject/cancel — that part mirrors the budget system and works today. But the **reset
cycle is not actually enforced**: `quota.reset_cycle` (MONTHLY / QUARTERLY / YEARLY) is
stored yet `quota_usage` carries no period, and net-usage sums **every** row for all
time. A MONTHLY booking quota never resets, and a personal YEARLY leave balance wrongly
subtracts prior-year usage from this year's entitlement. There is also **no admin UI at
all** — quotas, entitlements, mid-year adjustments, and carry-forward can only be driven
by raw API calls. This change makes reset/carry-forward real and gives administrators the
screens to manage it.

## What Changes

- **Periodized usage accounting.** Bind every `quota_usage` row to the reset period it
  belongs to (year + period index) and scope net-usage / remaining to the current period
  so MONTHLY, QUARTERLY, and YEARLY quotas reset correctly. Personal balances count only
  the entitlement year's usage. **BREAKING** to the derived-balance read shape (adds
  period context) — internal only, no archived spec depends on it.
- **Carry-forward & period close as a batch operation.** Add a quota-level rollover that
  seeds the next period's entitlement (`carried_over = prior remaining`) for **all**
  employees of a quota in one call, governed by `reset_cycle` and a carry-forward policy
  flag, replacing today's one-employee-at-a-time `rollover`.
- **Mid-year entitlement adjustment.** A dedicated `adjust` endpoint that increases or
  decreases `quota_entitlement.adjusted` with a reason, instead of overwriting the whole
  entitlement row.
- **Entitlement read endpoints.** List/query `quota_entitlement` rows per quota and year
  so the admin UI can render and edit them (none exist today).
- **Quota administration frontend (new).** Vue screens to create/edit/deactivate quotas,
  manage per-person entitlements, run mid-year adjustments, and execute carry-forward —
  the end-user `web-quota` screens stay read-only.

## Capabilities

### New Capabilities
- `web-quota-admin`: PrimeVue admin screens for quota definitions, per-person
  entitlements, mid-year adjustment, and carry-forward/period-close, gated by
  `QUOTA_MANAGE`.

### Modified Capabilities
- `quota-management`: net-usage and remaining become period-scoped; carry-forward becomes
  a quota-wide period-close operation with a policy flag; add a mid-year adjustment
  operation and `quota_entitlement` read endpoints.

## Impact

- **DBML / migration:** add period columns to `quota_usage` (e.g. `period_year`,
  `period_index`) and a carry-forward policy flag to `quota`. New columns only; no
  inter-company change, append-semantics of the usage ledger preserved (corrections stay
  RELEASE rows).
- **Backend:** `quota-balance.service` (period-scoped net usage/remaining/breakdown),
  `quota-usage.service` (stamp period on reserve; release within period),
  `quota-entitlement.service` + controller (batch rollover, adjust, reads), `quota.dto`.
  `document-submit.service` reserve call unchanged in shape.
- **Frontend:** new `web-quota-admin` views, store, API client, i18n (en/la); routing and
  nav gated by `QUOTA_MANAGE`.
- **Invariants:** preserves company isolation (all reads/writes active-company scoped),
  the append-only usage ledger (no UPDATE/DELETE), derived balances (never store a usage
  total), and concurrency-safe reservation (pessimistic locks unchanged). Reset/period
  logic must not let a RELEASE cross period boundaries.

## Context

Quota management is largely built. The backend already has: quota CRUD
(company/department scoped, deactivate-not-delete), personal entitlements with
`entitled_value` / `carried_over` / `adjusted`, a concurrency-safe reserve/release engine
(`quota-usage.service` with `LockMode.PESSIMISTIC_WRITE`), derived reads
(`quota-balance.service`: remaining / breakdown / usage ledger), and full document-lifecycle
wiring — `document-submit.service` reserves on submit and `releaseDocumentHolds` releases
on reject/cancel, exactly mirroring budget. The end-user `web-quota` read-only screens
(list, breakdown, usage ledger) exist.

Two gaps remain against the requested behavior:

1. **Reset cycles are not enforced.** `quota.reset_cycle` is stored but `quota_usage` has
   no period column, and `QuotaBalanceService.netUsage` sums *every* row for all time.
   Result: a MONTHLY/QUARTERLY quota never resets, and a personal YEARLY balance wrongly
   subtracts prior-year usage from the current year's entitlement. `rollover` exists but
   is one-employee-at-a-time and has no carry-forward policy gate.
2. **No administration UI** and a few missing admin endpoints (mid-year adjust, entitlement
   reads, quota-wide carry-forward). Today only raw API calls can manage quotas.

Constraints: append-only usage ledger (corrections are RELEASE rows, never UPDATE/DELETE),
derived balances (never store a usage total), company isolation on every read/write,
quantities as decimal strings via the existing `Money` helper.

## Goals / Non-Goals

**Goals:**
- Make MONTHLY / QUARTERLY / YEARLY resets correct by periodizing `quota_usage` and scoping
  net-usage / remaining / breakdown to a period.
- Provide quota-wide carry-forward (period close) gated by a per-quota policy flag.
- Add mid-year entitlement adjustment and entitlement read endpoints.
- Ship a `QUOTA_MANAGE` admin frontend for definitions, entitlements, adjustment, and
  carry-forward.

**Non-Goals:**
- No scheduled/cron auto-reset job — period boundaries are computed on read; carry-forward
  is an explicit admin action (a scheduler can call it later).
- No change to budget, to the reserve/release engine's locking, or to the document submit
  contract (`quotaReservations` shape stays the same).
- No new quota *unit* model — unit stays free-text (day/hour/count/currency).

## Decisions

### Periodization by stamping, computed boundaries on read
Add `period_year` (int) and `period_index` (smallint) to `quota_usage`. At reserve time
`QuotaUsageService` derives the period from the quota's `reset_cycle` and the document's
effective date: YEARLY → index 1; QUARTERLY → 1–4; MONTHLY → 1–12; NONE → a single open
period (year 0, index 0). `netUsage` / `remaining` / `breakdown` take an optional
`{ periodYear, periodIndex }` (defaulting to the current period) and filter the usage
query by it. Personal entitlement remains keyed by `year`; usage for personal quotas is
filtered to that year so prior-year usage no longer bleeds in.

*Alternative considered:* a separate `quota_period` table with stored balances — rejected,
it would violate the derived-balance invariant and add reconciliation surface. Stamping +
on-read filtering keeps balances purely derived.

### RELEASE inherits the USE period
`releaseAll` already groups outstanding USE by (quota, employee); it will additionally
group by (period_year, period_index) and stamp each RELEASE with the same period as the USE
it offsets. This guarantees a reject in Q2 cannot restore quota into Q1's pool or vice
versa, keeping each period's `Σ USE − Σ RELEASE` self-consistent.

### Carry-forward as an explicit, idempotent, quota-wide operation
Replace single-employee `rollover` with `carryForward({ quotaId, fromYear, toYear })` (and
period index where the cycle is sub-annual). It reads each source-period entitlement's
derived remaining and upserts the target period's `carried_over`. Gated by a new
`quota.carry_forward` boolean policy — when false, `carried_over` is forced to 0.
Idempotent: re-running for the same source/target overwrites `carried_over` to the same
computed value rather than accumulating.

### New columns, not new tables
`quota_usage.period_year`, `quota_usage.period_index`, and `quota.carry_forward` are
additive columns on existing DBML tables — no new tables, so no change proposal to the
37-table model beyond column additions. Migration backfills existing `quota_usage` rows
from `created_at` against each quota's `reset_cycle`.

### Admin UI as a new `web-quota-admin` capability
Mirrors the existing `web-*-admin` pattern (currency/rbac/org/employee admin). Keeps the
read-only end-user `web-quota` screens untouched. One Zod schema per form via
`@primevue/forms` + `zodResolver`, mirroring the backend DTOs; affordances gated by
`QUOTA_VIEW` / `QUOTA_MANAGE` from the active-company Pinia context.

## Transaction & locking notes (quota_usage writes)

- **Reserve (submit):** unchanged boundary — runs inside the document-submit
  `inTransaction`. `QuotaUsageService.reserveIn` locks the `Quota` row
  (`PESSIMISTIC_WRITE`) and, for personal quotas, the `(quota, employee, year)`
  `quota_entitlement` row, computes period-scoped remaining, then inserts the USE row.
  Lock order stays quota → entitlement (deterministic, no new lock added). Period stamping
  happens on the in-flight USE row, inside the same lock, so a concurrent reserve sees a
  consistent period balance.
- **Release (reject/cancel):** unchanged boundary — `releaseAll` runs in one transaction;
  it now partitions outstanding USE by period and inserts one RELEASE per
  (quota, employee, period). No UPDATE/DELETE — append-only preserved.
- **Carry-forward:** wraps all per-employee entitlement upserts for the quota in a single
  `em.transactional()` so a period close is atomic; it reads derived remaining per employee
  under that transaction. No `quota_usage` writes occur.
- **Adjustment:** single-row `quota_entitlement` update to `adjusted` within one
  transaction; locks the entitlement row to avoid a lost update against a concurrent
  upsert/carry-forward.

## Risks / Trade-offs

- [Backfilling `period_*` on existing `quota_usage` could mis-bucket historic rows] →
  derive period from `created_at` per the quota's current `reset_cycle`; document that
  changing a quota's `reset_cycle` after usage exists does not retro-rebucket prior rows
  (new periods apply going forward).
- [On-read period filtering adds a predicate to hot balance queries] → indexed by
  `(quota_id, period_year, period_index)`; net-usage already scans by `quota_id`, so cost
  is marginal.
- [Changing a quota's `reset_cycle` mid-life makes "current period" ambiguous for in-flight
  reservations] → reset cycle edits are a `QUOTA_MANAGE` action; UI warns that the change
  affects future periods only.
- [Carry-forward run twice or for the wrong year] → idempotent upsert (overwrite, not
  accumulate) plus an admin confirmation step in the UI.

## Migration Plan

1. DBML + MikroORM migration: add `quota_usage.period_year` (int, not null, default 0),
   `quota_usage.period_index` (smallint, not null, default 0), `quota.carry_forward`
   (boolean, default true); add index `(quota_id, period_year, period_index)`.
2. Data migration: backfill `period_year` / `period_index` on existing `quota_usage` from
   `created_at` against each quota's `reset_cycle`.
3. Deploy backend (period-scoped reads, adjust/entitlement-read/carry-forward endpoints) —
   backward compatible: existing reserve calls still work, default period = current.
4. Deploy frontend `web-quota-admin`.
5. Rollback: columns are additive with safe defaults; reverting the service layer falls
   back to all-time net usage without schema rollback. UI is independently revertible.

## Open Questions

- For sub-annual cycles (MONTHLY/QUARTERLY), should personal entitlement be per-year (as
  today) with usage period-scoped, or should entitlement also be period-indexed? Default:
  keep entitlement yearly, scope usage by period — revisit only if a per-month personal
  entitlement is needed.
- Should the period boundary follow the company fiscal year (multi-company has fiscal
  years) rather than the calendar year? Default to calendar year for v1; fiscal alignment
  can layer on later via the company's fiscal config.

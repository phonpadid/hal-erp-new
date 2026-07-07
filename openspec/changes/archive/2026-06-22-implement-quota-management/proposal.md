## Why

`quota-management` is the structural twin of budget-control: allowances (leave days, OT
hours, booking counts) that documents reserve on submit and release on reject/cancel
(invariant 4/5), at company, department, or per-person level. The scaffold ships the
entities (`quota`, `quota_usage`, `quota_entitlement`); this change delivers the **quota
ledger engine** — definition, per-person entitlements with carry-forward, derived
remaining, and concurrency-safe reserve/release — that document-engine will call on
submit/reject.

## What Changes

- **`QuotaManagementModule`** registering the three entities, with services + controllers.
- **Quota definition**: CRUD for `quota` (type, unit, `limit_value`, `reset_cycle`,
  optional department; null = company-level), company-scoped, guarded by
  `QUOTA_MANAGE` / `QUOTA_VIEW`; deactivate-not-delete via `is_active`.
- **Personal entitlements**: CRUD for `quota_entitlement` (per employee + quota + year:
  `entitled_value`, `carried_over`, `adjusted`). A **rollover** operation seeds the next
  year's `carried_over` from the prior year's remaining (carry-forward).
- **Derived remaining** (`QuotaBalanceService`):
  - personal: `entitled + carried_over + adjusted − net usage(quota, employee)`
  - quota-level: `limit_value − net usage(quota)`
  where `net usage = Σ USE − Σ RELEASE` over `quota_usage`.
- **Reserve on submit** (`reserve`): in one `em.transactional`, lock the quota row (and,
  for personal quotas, the entitlement row) `FOR UPDATE`, enforce remaining (block when a
  reservation would exceed it — over-quota), and insert a USE `quota_usage` row.
- **Auto-release** (`releaseAll`): on reject/cancel, insert RELEASE rows restoring the
  document's outstanding USE for each quota (invariant 4/5 — reject/cancel frees quota).
- **Concurrency test**: two concurrent reservations of the last remaining unit — exactly
  one succeeds (quota_usage writes are grouped with budget_txn under the transactional +
  lock rule in CLAUDE.md).

`quota_usage` is **not** an append-only ledger in the DBML (no audit note), so — unlike
`budget_txn` — corrections are RELEASE rows but the LedgerGuard does not apply to it.

No schema change — the three entities already match the DBML.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `quota-management`: adds the concrete administration/accounting requirements the
  existing five implied but did not pin down — quota & entitlement administration with a
  derived-remaining query, net-usage accounting with exact auto-release, and
  concurrency-safe reservation. The five existing requirements (Quota Definition, Personal
  Entitlement, Quota Reservation Mirrors Budget, Over-Quota Enforcement, Reset and Carry
  Forward) are unchanged.

## Impact

- **Affected capability**: `quota-management` (unblocks document-engine quota
  reserve/release for HR-style documents like leave requests).
- **Invariants exercised**: **4/5** (reserve → release; reject/cancel auto-releases), the
  concurrency rule (`em.transactional` + `PESSIMISTIC_WRITE` on quota/entitlement rows),
  **1** (company isolation — `quota` is company-scoped), **5** (`QUOTA_VIEW` /
  `QUOTA_MANAGE`).
- **Code**: new `back/src/modules/quota/` services, controllers, DTOs, module; registered
  in `AppModule`. Reuses `inTransaction` / `lockForUpdate` and `Money`.
- **New permission codes**: `QUOTA_VIEW`, `QUOTA_MANAGE`.
- **Consumers (later)**: document-engine calls `reserve` / `releaseAll`; these are
  delivered and unit/concurrency-tested here.

## Out of Scope

- Document submit/reject that *trigger* reserve/release (document-engine) — caller supplies
  document id + quota id + quantity (+ employee for personal quotas).
- Automatic period reset jobs (scheduler) — rollover is provided as an operation; when it
  runs is a later concern. `quota_usage` has no period column, so usage is scoped per
  (quota, employee); the year dimension lives on entitlement (documented limitation).

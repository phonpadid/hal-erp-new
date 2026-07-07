## Why

The Quota Admin → Entitlements tab is completely broken: selecting a quota fires
`GET /quota-entitlements?quotaId=…&year=2026` and the server rejects it with HTTP 400
(`"year must be an integer number"`). The rows never load and error toasts stack up.
The cause is a validation gap — `EntitlementQueryDto.year` validates as an integer but
never coerces the incoming query-string value from `string` to `number`, so a perfectly
valid `year=2026` fails. The sibling reporting DTO already does this correctly; this one
was simply missed.

## What Changes

- Add `@Type(() => Number)` to `EntitlementQueryDto.year` so the optional `year` query
  parameter is coerced from its string form before `@IsInt/@Min/@Max` run, matching the
  established pattern in `reporting/dto/report-filters.dto.ts` (`QuotaRemainingQueryDto.year`).
- The per-employee entitlement list read (`GET /quota-entitlements`) once again accepts a
  `year` filter and returns the period's rows instead of 400-ing.
- No API shape change, no new fields, no behavior change beyond making the documented
  year filter actually work. Not a breaking change.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `quota-management`: pin the intended behavior of the entitlement list read — its
  optional reset-period `year` filter is accepted as a query parameter (coerced from the
  query string) rather than rejected. This is a regression-locking clarification of the
  existing "Quota and Entitlement Administration" read; no requirement is being weakened.

## Impact

- **Code:** `back/src/modules/quota/dto/entitlement.dto.ts` — one decorator added to
  `EntitlementQueryDto.year` (plus the `class-transformer` `Type` import).
- **API:** `GET /quota-entitlements?quotaId=…&year=…` returns 200 with rows instead of 400.
- **Frontend (unblocked, unchanged):** `web-quota-admin` Entitlements tab
  (`front-end/src/views/admin/QuotaAdminView.vue`) can load and render entitlement rows;
  no frontend code change is required for this fix.
- **Invariants:** none affected — company scope, append-only ledgers, and derived balances
  are untouched; this is input validation only.
- **Tests:** add a controller/e2e assertion that the list endpoint accepts a string
  `year` query param and returns 200.

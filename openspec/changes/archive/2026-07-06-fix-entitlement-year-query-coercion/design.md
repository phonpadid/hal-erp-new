## Context

`GET /quota-entitlements` (handler `QuotaEntitlementController.list`) binds its query
string to `EntitlementQueryDto`. The global `ValidationPipe` runs with
`transform: true` but **without** `enableImplicitConversion`, so class-transformer does
not auto-convert primitive query params to their declared TS types. `quotaId` is a
`string` so it passes; `year` is declared `number` and validated with `@IsInt/@Min/@Max`,
but the raw value off the URL is the string `"2026"`, which `@IsInt()` rejects → HTTP 400.

The correct pattern is already used elsewhere in the codebase:
`reporting/dto/report-filters.dto.ts` → `QuotaRemainingQueryDto.year` decorates the same
kind of field with `@Type(() => Number)` so it is coerced before the integer checks run.
`EntitlementQueryDto.year` simply omits that decorator.

This read is a pure GET: it does not write `budget_txn` or `quota_usage`, opens no
transaction, and takes no locks. There is no ledger or concurrency surface to design for.

## Goals / Non-Goals

**Goals:**
- Make `GET /quota-entitlements` accept the optional `year` query parameter (string form
  on the wire) and return the period's entitlement rows.
- Keep the fix consistent with the existing `@Type(() => Number)` convention.
- Guard against regression with a test that sends `year` as a query string.

**Non-Goals:**
- No change to the response shape, permissions (`QUOTA_VIEW`), or company scoping.
- No change to the write DTOs (`UpsertEntitlementDto`, `AdjustEntitlementDto`,
  `CarryForwardDto`) — those receive `year` in a JSON body where it is already a number.
- No global `ValidationPipe` change (e.g. `enableImplicitConversion`); a broad pipe change
  would silently alter coercion across every DTO and is out of scope for a targeted fix.
- No frontend change — `QuotaAdminView.vue` already sends the correct request.

## Decisions

- **Add `@Type(() => Number)` to `EntitlementQueryDto.year`** (and import `Type` from
  `class-transformer`). Chosen because it is the smallest change, is local to the one
  broken DTO, and matches the precedent in `report-filters.dto.ts`.
  - _Alternative: enable `enableImplicitConversion` globally._ Rejected — it changes
    coercion semantics for all DTOs at once, risking unrelated behavior shifts, for no
    benefit over the local decorator.
  - _Alternative: accept `year` as a string and parse it in the service._ Rejected —
    pushes validation concerns into business logic and diverges from the DTO-validates
    convention used everywhere else.

## Risks / Trade-offs

- **Risk:** a non-numeric `year` (e.g. `year=abc`) now coerces to `NaN` before validation.
  → Mitigation: `@IsInt()` rejects `NaN`, so it still returns 400 for genuinely bad input;
  only valid numeric strings are accepted. Covered by the regression test.
- **Trade-off:** the decorator is applied per-DTO rather than fixing the class of problem
  globally. Accepted deliberately (see Non-Goals) to keep the blast radius to one field.

## 1. Fix

- [x] 1.1 In `back/src/modules/quota/dto/entitlement.dto.ts`, import `Type` from `class-transformer`.
- [x] 1.2 Add `@Type(() => Number)` to `EntitlementQueryDto.year`, above the existing `@IsInt/@Min/@Max` decorators, mirroring `QuotaRemainingQueryDto.year` in `reporting/dto/report-filters.dto.ts`.

## 2. Test

- [x] 2.1 Add a test asserting the entitlement query accepts `year` as a query string (coerced to a number) — via a `ValidationPipe` transform test on `EntitlementQueryDto` (no DB harness exists for HTTP-level e2e). Confirmed it fails without the `@Type` decorator.
- [x] 2.2 Add a test asserting a non-numeric `year` (e.g. `year=abc`) and an out-of-range year are still rejected.

## 3. Verify

- [x] 3.1 Run the quota module tests (`vitest`) and confirm they pass.
- [x] 3.2 In the running app, open Quota Admin → Entitlements, select a quota, and confirm the entitlement rows load without a 400 / error toast. Verified live: GET returns 200, rows render, columns aligned at 1440/1100/900/768px, no console errors.

## 1. Money helper

- [x] 1.1 Add `Money.multiply(a, b)` (decimal-safe, string in/out) to `common/money/money.ts`; add a unit test (incl. that `"19.99" * "1000" ` stays exact and a JS-number arg is rejected like the other helpers).

## 2. Module scaffolding & DTOs

- [x] 2.1 Create `MultiCurrencyModule` (`MikroOrmModule.forFeature([Currency, ExchangeRate])`); register in `AppModule`.
- [x] 2.2 Add permission-code constants `CURRENCY_VIEW`, `CURRENCY_MANAGE` in a module `permissions.ts`.
- [x] 2.3 Add class-validator DTOs: create/update currency; create exchange-rate (`fromCurrency`, `toCurrency`, `rate` as `@IsNumberString`, `rateDate`, optional `rateType`, optional `companyId` for an override, optional `source`); a resolve query DTO (`from`, `to`, `asOf`, optional `rateType`).

## 3. Currency registry

- [x] 3.1 `CurrencyService`: create/update/list/get/deactivate (deactivate sets `is_active = false`, never delete; default list omits inactive). `code` (ISO) is the id; length-validated, not a UUID.
- [x] 3.2 `CurrencyController`: REST guarded by `CURRENCY_MANAGE`/`CURRENCY_VIEW`; `JwtAuthGuard` + `PermissionsGuard`; path param is the currency code (length-validated).

## 4. Exchange rates: registry + resolution + conversion

- [x] 4.1 `ExchangeRateService.createRate(dto)`: create a group (`company = null`) or per-company override row; stamp `created_by` from context.
- [x] 4.2 `resolveRate({ from, to, asOf, rateType?, companyId? })`: identity (from==to→`'1'`) → company override (latest `rate_date <= asOf`, desc) → group → inverse (1/rate of reverse pair) → else reject. Returns `{ rate, source, asOf, rateType }`.
- [x] 4.3 `convert({ amount, from, to, asOf, rateType?, companyId? })`: `Money.multiply` by the resolved rate, round to the target currency's `decimal_places`; returns `{ baseAmount, rate, source }`.
- [x] 4.4 `ExchangeRateController`: `POST /exchange-rates` + `GET /exchange-rates` (guarded by `CURRENCY_MANAGE`/`CURRENCY_VIEW`) and `GET /exchange-rates/resolve` (debug/ops, `CURRENCY_VIEW`).

## 5. Tests

- [x] 5.1 Resolution: latest `rate_date <= asOf` chosen; a later-dated rate does not affect an earlier `asOf` (as-of-deterministic).
- [x] 5.2 Company override beats the group rate for the same pair/date/type.
- [x] 5.3 Identity (from==to → 1, no row) and inverse fallback (only reverse pair exists → 1/rate).
- [x] 5.4 Conversion rounds to target `decimal_places`: into JPY (0) rounds to whole units; into THB (2) keeps 2; base amount = amount × locked rate.
- [x] 5.5 No rate available → `resolveRate` rejects.

## 6. Verify

- [x] 6.1 `pnpm --filter back build` and `pnpm --filter back test` pass.
- [x] 6.2 Run `openspec validate implement-multi-currency --strict`.

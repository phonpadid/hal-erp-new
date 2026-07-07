## Context

The scaffold provides `currency` (PK = ISO code, not company-scoped) and
`exchange_rate` (uuid PK, nullable `company` = group vs per-company override, also not a
`CompanyScopedEntity` — it's a special master). `Money` provides string-safe
add/subtract/compare/round but no multiply. `multi-company`, `rbac`, `master-data` are
implemented. This slice adds behavior only — no schema change.

## Goals / Non-Goals

**Goals**
- CRUD for currencies (deactivate-not-delete) and create/list for exchange rates
  (group + per-company override), permission-gated.
- `resolveRate({ from, to, asOf, rateType?, companyId? })` — latest `rate_date <= asOf`,
  company override beats group, plus identity (from==to→1) and inverse (1/rate) fallback.
- `convert({ amount, from, to, asOf, ... })` — exact decimal multiply, rounded to the
  target currency's `decimal_places`.
- A `Money.multiply` helper (string in/out, decimal-safe).
- Deliver resolver + converter for budget-control / document-engine to consume; unit-test.

**Non-Goals**
- Writing/locking the rate onto `document` and the never-recompute rule (document-engine).
- FX gain/loss posting at payment (budget-control / payment slice).
- Automated rate feeds (BOT/bank import); rates are entered via the admin endpoint.
- Triangulation via an intermediary currency (A→USD→B). Only direct + inverse for now.

## Decisions

### D1 — `currency` and `exchange_rate` are global masters, permission-gated
Neither is a `CompanyScopedEntity`. Currency CRUD and rate management are gated by
`CURRENCY_MANAGE` (writes) / `CURRENCY_VIEW` (reads) with no company filter. A
per-company **override** is just an `exchange_rate` row with `company_id` set; a group
rate has `company_id = null`. Resolution is parameterized by `companyId` (passed by the
caller / from context) rather than relying on the company filter, because group rows
(null company) must remain visible alongside company rows. *Alternative considered:*
make `exchange_rate` company-scoped — rejected, it would hide group rates.

### D2 — Resolution order: identity → company override → group → inverse
`resolveRate({ from, to, asOf, rateType = 'DAILY', companyId })`:
1. **Identity**: `from === to` → `{ rate: '1', source: 'IDENTITY' }`, no DB hit.
2. **Company override**: latest `exchange_rate` where `company = companyId`, `fromCurrency
   = from`, `toCurrency = to`, `rateType`, `rate_date <= asOf`, ordered `rate_date` desc.
3. **Group**: same but `company IS NULL`.
4. **Inverse**: repeat 2–3 for the reverse pair `to → from`; if found, `rate = 1 / rate`
   (decimal divide), `source: 'INVERSE'`.
5. **None** → `BadRequestException('no rate for <from>→<to> as of <asOf>')`.
Returns `{ rate: string, source, asOf, rateType }`. Ordering by `rate_date desc` + limit 1
gives the latest-on-or-before semantics; resolution is a pure function of `asOf`, so a
later-dated rate never affects an earlier `asOf` (the basis document-engine relies on to
lock).

### D3 — Conversion rounds to the target currency
`convert({ amount, from, to, asOf, rateType?, companyId? })`:
`raw = Money.multiply(amount, rate)`, then `Money.round(raw, target.decimalPlaces)`.
Returns `{ baseAmount, rate, source }`. The target currency's `decimal_places` is loaded
from `currency`. Rounding mode is half-up (Decimal default `toFixed`), consistent with
the existing `Money.round`. `Money.multiply` is added to the helper:
`new Decimal(a).times(b).toString()`.

### D4 — Inverse precision
Inverse uses `new Decimal(1).div(rate)`; decimal.js default precision (20 sig figs) is
ample for an 18,8 rate. The inverted value is used only for the conversion multiply (then
rounded to target decimals); we do not persist inverted rates. Documented so a future
"store both directions" decision is explicit rather than accidental.

### D5 — DTOs / endpoints
- `currencies`: CRUD (code is the id in the path — a 3-char string, validated by length,
  not `ParseUUIDPipe`).
- `exchange-rates`: `POST` (create group/override), `GET` (list, optional filters),
  and `GET /exchange-rates/resolve?from&to&asOf&rateType` for ops/debugging.
- DTOs are class-validator; amounts/rates are strings (`@IsNumberString`).

## Risks / Trade-offs

- **Currency id is a string PK, not uuid** → use a length-validated path param, not
  `ParseUUIDPipe`; `em.getReference`/lookups use the code. (Same quirk handled earlier in
  `CompanyService.resolveActiveCurrency` by loading the entity rather than `getReference`.)
- **Inverse can mask missing data** → it's a fallback after direct lookup fails and is
  marked `source: 'INVERSE'` in the result so callers/audits can see it. Triangulation is
  explicitly out of scope.
- **Rounding mode** half-up may not match every accounting policy → centralized in
  `Money.round`; a per-currency rounding policy can be added later without touching call
  sites.
- **No rate stamped here** → locking is document-engine's job; this slice only resolves.
  Risk that a consumer recomputes instead of locking is mitigated by documenting the
  contract and by document-engine's own "never recompute" test.

## Migration Plan

No DB migration. Steps: add `Money.multiply` (+ test); build `MultiCurrencyModule`
(services, controllers, DTOs, permission constants); register in `AppModule`; add
unit/integration tests; `pnpm build` + `pnpm test`. Rollback = revert the module +
helper (no data/schema impact).

## Open Questions

- Should resolution support triangulation through the group base (A→USD→B) when neither
  direct nor inverse exists? Default: no (out of scope); revisit if real data needs it.
- Should `rate_type` selection be company-policy-driven (DAILY vs MONTHLY_AVG vs
  BUDGET_RATE)? Default: caller passes `rate_type` (defaulting to DAILY); a company FX
  policy table can drive it later.

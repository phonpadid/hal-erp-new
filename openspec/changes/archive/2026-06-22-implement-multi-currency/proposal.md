## Why

`multi-currency` is the critical-path dependency for `budget-control` and
`document-engine`: documents can be in any currency, but budgets are controlled and
approval thresholds compared in the company base currency, with the FX rate locked onto
the document at submit (invariant 6). The scaffold ships the `currency` and
`exchange_rate` entities but no behavior. This change delivers the currency/rate
registries plus the **rate resolver** and **base-currency converter** that downstream
slices call — so the document engine can stamp a locked rate and store both
`total_amount` and `base_total_amount`.

## What Changes

- **`MultiCurrencyModule`** registering `currency` + `exchange_rate`, with services and
  controllers.
- **Currency registry**: CRUD for `currency` (ISO 4217 code as PK, `decimal_places`),
  guarded by `CURRENCY_MANAGE` / `CURRENCY_VIEW`; deactivate-not-delete via `is_active`.
- **Exchange-rate registry**: create/list `exchange_rate` rows — group-wide
  (`company = null`) or per-company override — with `rate_type`, `rate_date`, `source`,
  and `created_by` stamped from context. Guarded by `CURRENCY_MANAGE`.
- **Rate resolution** (`ExchangeRateService.resolveRate`): pick the latest row whose
  `rate_date <= asOf` for the `rate_type`, preferring a **company override** over the
  group rate. Adds two pragmatic rules the base spec implied: **identity** (from == to →
  rate 1, no row needed) and **inverse fallback** (if no direct pair exists, use 1/rate
  of the reverse pair). Returns the rate plus which source matched.
- **Base-currency conversion** (`convert`): multiply a document amount by the resolved
  rate and round to the **target currency's `decimal_places`** (e.g. JPY 0, THB 2) — the
  `base_total_amount` budget/threshold logic uses. Adds a `Money.multiply` helper
  (decimal-safe, string in/out) to the existing `Money` utility.
- **Money invariant**: rates and amounts are DECIMAL carried as strings throughout;
  rounding is currency-aware; never a JS number.

No schema change — the two entities already match the DBML.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `multi-currency`: adds the concrete rules the existing five requirements implied but
  did not pin down — currency/rate administration (permission-gated, deactivate-not-
  delete), **identity & inverse** resolution, and **currency-aware rounding** of
  conversions. The five existing requirements (Currency Registry, Exchange Rate Lookup,
  Locked Rate on Document, Budget Controlled in Base Currency, FX Difference Goes to
  Accounting) are unchanged.

## Impact

- **Affected capability**: `multi-currency` (unblocks budget-control and document-engine
  base-amount conversion + locked FX).
- **Invariants exercised**: 6 (locked FX — the resolver returns a rate to stamp;
  resolution is `asOf`-deterministic so a later rate never moves an earlier date),
  money-as-decimal (string math, currency-aware rounding), 5 (permission codes
  `CURRENCY_VIEW` / `CURRENCY_MANAGE`).
- **Code**: new `back/src/modules/currency/` services, controllers, DTOs, module;
  registered in `AppModule`. A `Money.multiply` addition to `common/money`.
- **New permission codes**: `CURRENCY_VIEW`, `CURRENCY_MANAGE`.
- **Consumers (later)**: document-engine calls `resolveRate`/`convert` at submit to lock
  the rate and compute `base_total_amount`; budget-control compares in base currency.
  These are delivered and unit-tested here. Locking the rate onto the document (write +
  never-recompute) and the payment-time FX gain/loss posting are **document-engine /
  budget-control** responsibilities — out of scope here, noted for the consumers.

## Out of Scope

- Writing/locking the rate onto `document` and enforcing never-recompute (document-engine).
- Posting FX gain/loss to accounting at payment (budget-control / payment slice).
- Rate import feeds (BOT/bank); rates are entered via the admin endpoint for now.

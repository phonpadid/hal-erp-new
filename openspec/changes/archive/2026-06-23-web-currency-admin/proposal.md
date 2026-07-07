## Why

Multi-currency documents stamp a locked FX rate at submit (invariant 6), and budget balances
are derived in the company base currency — both depend on the currency list and the exchange-rate
table being maintained. Today currencies and rates exist only via the seed; there's no UI to add a
currency or record today's FX rate. This change adds the currency admin so an admin can manage
currencies and exchange rates without re-seeding — the last money-related configuration gap.

The multi-currency backend is already complete (currencies CRUD; exchange rates create + list +
resolve), so this is a frontend-only change.

## What Changes

- **New capability `web-currency-admin`** — the currency admin in the Vue shell, a tabbed area:
  Currencies · Exchange Rates.
- **Currencies** (`CURRENCY_VIEW` / `CURRENCY_MANAGE`): list, create (ISO code, name, symbol,
  decimal places), and edit (name/symbol/decimal places/active).
- **Exchange Rates** (`CURRENCY_VIEW` / `CURRENCY_MANAGE`): list rates (with a from/to filter) and
  add a rate (from → to, rate, effective date, rate type). Rates are **append-only** — a
  correction or a new day is a new dated row, never an edit, mirroring the locked-FX rule.
- **Shell integration**: a "Currencies" nav entry (gated by `CURRENCY_VIEW`); a typed
  `api/currency.ts` + a Pinia store; create forms use `@primevue/forms` + `zodResolver` with
  schemas shared in `@erp/shared`. Rate amounts are carried as decimal strings, never JS numbers.
- **Tests**: frontend unit tests for the currency store and the shared schemas.

## Capabilities

### New Capabilities
- `web-currency-admin`: the Vue currency admin — manage currencies and append-only exchange
  rates, permission-gated.

## Impact

- **Affected**: `front-end/` (tabbed view, store, api, router/nav) and `shared/` (Zod schemas for
  currency + exchange rate).
- **Invariants reflected**: 6 (exchange rates are the data behind the locked-FX-at-submit rule;
  rates are append-only here, never overwritten); 5 (view by `CURRENCY_VIEW`, manage by
  `CURRENCY_MANAGE`; server enforces); money as decimal strings; validation parity (shared Zod).
- **Consumes**: existing `/currencies` CRUD and `/exchange-rates` (create + list). No new
  endpoint, no schema change, no new dependency.

## Out of Scope

- Rate **resolve/convert** as a user tool (the engine uses `/exchange-rates/resolve` at submit;
  a manual converter widget is a later nicety).
- Per-company rate overrides UI beyond recording group-wide rates (the backend supports a
  `companyId` on a rate; this slice records group-wide rates — `companyId` omitted).
- Editing or deleting an existing rate row (append-only by design; corrections are new rows).
- Automated rate feeds / scheduled imports.

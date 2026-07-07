## Context

The multi-currency backend is complete: `/currencies` (create/list/get/patch/delete, guarded
`CURRENCY_VIEW`/`CURRENCY_MANAGE`) and `/exchange-rates` (create, list with a `{from,to,rateType}`
filter, and `resolve`). `Currency` = `{ code (PK, ISO), name, symbol?, decimalPlaces, isActive }`;
`ExchangeRate` = `{ id, company? (null = group-wide), fromCurrency, toCurrency, rate (decimal
string), rateDate, rateType, source? }` — unique on (company, from, to, rateDate, rateType).
Exchange rates have no update/delete endpoint: they are append-only. The Vue shell + prior admin
slices give `can()`, the typed-api/store pattern, `@primevue/forms` + `zodResolver`, and
`@erp/shared`.

## Goals / Non-Goals

**Goals**
- Vue currency admin: Currencies (list/create/edit) + Exchange Rates (list + filter + add),
  permission-gated, forms validated against shared Zod schemas, rates as decimal strings.
- Tests: currency store + shared schemas.

**Non-Goals**
- A manual convert/resolve widget, per-company rate overrides, editing/deleting existing rates,
  automated rate feeds.

## Decisions

### D1 — Shared Zod schemas
Add to `@erp/shared`: `currencyCreateSchema` (code ISO 3-char upper, name, symbol?, decimalPlaces
int 0–6) and `exchangeRateSchema` (fromCurrency, toCurrency 3-char, rate a positive decimal
string, rateDate ISO, rateType default `DAILY`), mirroring the DTOs (CLAUDE.md parity). Rate is a
string validated with a decimal regex — never coerced to a JS number.

### D2 — Frontend data layer
`api/currency.ts`: currencies (list/create/update), exchangeRates (list({from?,to?,rateType?}) /
create). `stores/currency.ts` (Pinia): `currencies`, `rates`, `rateFilter`, `loading`, `error`;
`loadCurrencies`, `loadRates(filter)`, mutation wrappers that refresh; capture errors.

### D3 — Tabbed Currency view
`views/admin/CurrencyAdminView.vue` with PrimeVue `Tabs`:
- **Currencies**: table (code, name, symbol, decimal places, active) + create/edit dialog
  (`currencyCreateSchema`; code disabled on edit since it's the PK).
- **Exchange Rates**: a from/to filter row (currency `Select`s, both clearable) + table (from, to,
  rate, date, type) + "Add rate" dialog (`exchangeRateSchema`; from/to are currency `Select`s,
  rate a text input kept as string, date a native date input, type a `Select` of common types).
Manage controls gated by `can('CURRENCY_MANAGE')`. Dialogs use `<Form :resolver>` + `<FormField>`
+ `<Message>`. Group-wide rates only (no `companyId` sent).

### D4 — Routing & nav
Route `currency-admin` (`meta.permission='CURRENCY_VIEW'`); a "Currencies" nav item gated by
`can('CURRENCY_VIEW')` added to the layout store's `NAV` + i18n (la/en). Admin (all codes) sees it.

### D5 — Tests
- Frontend (Vitest): currency store with a mocked api (loaders populate; `createCurrency` /
  `addRate` call the right endpoint and refresh; `loadRates` passes the filter; error captured) +
  shared-schema validation (valid currency/rate; bad ISO code length, non-numeric rate, and a
  missing required field rejected).

## Risks / Trade-offs

- **Rate is a string** end-to-end (decimal precision); validated with a regex, displayed verbatim.
  No JS-number math (consistent with the money rule).
- **Append-only rates** — the UI offers add, not edit/delete, matching the backend; a "correction"
  is a new row for the same date/type (the unique constraint allows different rateType/date). If a
  user re-adds the same (from,to,date,type), the server's unique constraint rejects it; the error
  surfaces in the dialog.
- **Group-wide only** — this slice records `company`-null rates; per-company overrides are out of
  scope (backend still supports them via the API).

## Migration Plan

`shared`: add the two schemas; build. Frontend: add `api/currency.ts`, `stores/currency.ts`,
`CurrencyAdminView.vue`, router/nav, tests. `pnpm --filter @erp/shared build`, `pnpm --filter
front-end build/test`, `pnpm --filter back build`. Validate `openspec validate web-currency-admin
--type change --strict`. Rollback = revert the `front-end/` + `shared/` additions.

## Open Questions

- Rate-type options? Default: a `Select` of `DAILY` / `MONTHLY` / `CLOSING` with `DAILY` default
  (free-text fallback if needed).
- Show inactive currencies? Default: list all with an active flag; no separate filter this slice.

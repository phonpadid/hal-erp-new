## 1. Shared schemas

- [x] 1.1 In `@erp/shared`: `currencyCreateSchema` (code 3-char ISO upper, name, symbol?, decimalPlaces int 0–6) and `exchangeRateSchema` (fromCurrency, toCurrency 3-char, rate positive decimal string via regex, rateDate ISO string, rateType default 'DAILY'); export inferred types + a `RATE_TYPES` const. `pnpm --filter @erp/shared build`.

## 2. Frontend data layer

- [x] 2.1 `api/currency.ts`: currencies (list/create/update by code), exchangeRates (list({from?,to?,rateType?}) / create).
- [x] 2.2 `stores/currency.ts` (Pinia): `currencies`, `rates`, `rateFilter`, `loading`, `error`; `loadCurrencies`, `loadRates(filter)`, mutation wrappers (`createCurrency`/`updateCurrency`/`addRate`) that refresh after success; capture errors.

## 3. View & shell

- [x] 3.1 `views/admin/CurrencyAdminView.vue` with `Tabs`: Currencies (table + create/edit dialog, code disabled on edit) and Exchange Rates (from/to filter selects + table + "Add rate" dialog with from/to selects, rate text, date, rate-type select). Manage controls gated by `can('CURRENCY_MANAGE')`.
- [x] 3.2 Dialogs use `<Form :resolver="zodResolver(schema)">` + `<FormField>` + `<Message>` with the shared schemas; rate kept as a string (no JS-number coercion).
- [x] 3.3 Routing + nav: route `currency-admin` (`meta.permission='CURRENCY_VIEW'`); a "Currencies" nav item gated by `can('CURRENCY_VIEW')` (layout store NAV + i18n la/en).

## 4. Frontend tests

- [x] 4.1 currency store (mock `api`): `loadCurrencies`/`loadRates` populate (loadRates passes the filter); `createCurrency`/`addRate` call the right endpoint and refresh; error captured.
- [x] 4.2 Shared schemas: valid currency/rate accepted; bad ISO code length, non-numeric rate, and a missing required field rejected.

## 5. Verify

- [x] 5.1 `pnpm --filter @erp/shared build`, `pnpm --filter front-end build` + `pnpm --filter front-end test`, and `pnpm --filter back build` pass.
- [x] 5.2 Run `openspec validate web-currency-admin --type change --strict`.

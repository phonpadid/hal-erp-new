## 1. Base-currency context + formatting helper

- [x] 1.0 Backend: enrich `/auth/me` with the active company's base currency (`code` + `decimalPlaces`) — load the company once in the `me` handler; cover with the existing auth/me test if present.
- [x] 1.1 Surface the base currency on the front-end auth store (from `/auth/me`) so views can default the document currency and format base amounts.
- [x] 1.2 Add a small helper that maps a currency code → its `decimal_places` from the currency store (default 2), feeding the existing `formatAmount` util.

## 2. Exchange-rate admin form (source + scope)

- [x] 2.1 Add a `source` input (BOT / bank / manual) to the add-rate dialog in `CurrencyAdminView.vue`.
- [x] 2.2 Add a scope control — Group (no company) vs This company (active company id) — and send `source` + `companyId` on create (the API/DTO already accept them).
- [x] 2.3 Confirm the rate list shows the scope (company code / "Group") and the new source column/value.

## 3. Document currency picker + base preview

- [x] 3.1 Add a currency Select (active currencies, default = base currency) to `CreateDocumentView.vue`; include the chosen `currency` in the create payload.
- [x] 3.2 Live base preview: on currency/line changes call `/exchange-rates/resolve` (from doc currency, to base, asOf today), compute `sum(lineAmount) × rate` rounded to base `decimal_places`, show it as advisory (debounced; same-currency → rate 1; failed resolve → omit preview, never block).
- [x] 3.3 API/store wiring for the resolve read and passing `currency`.

## 4. Detail + inbox formatting

- [x] 4.1 `DocumentDetailView.vue`: add a locked-rate block (document currency, locked rate, base-currency label, formatted base total + line base amounts, lock date = submit date); format header/line amounts by `decimal_places`.
- [x] 4.2 `ApprovalInboxView.vue`: format the base total by the base currency's `decimal_places`.

## 5. Verification

- [x] 5.1 Frontend unit tests pass (`vitest`) and `vite build` (esbuild) succeeds; new store/util logic covered where practical. (vue-tsc remains red from the pre-existing Zod 3/4 mismatch, independent of this change.)
- [ ] 5.2 Manual smoke: create a document in a foreign currency (see the base preview), submit it, open the detail (locked rate + formatted base), and add a company-override rate with a source in the admin.

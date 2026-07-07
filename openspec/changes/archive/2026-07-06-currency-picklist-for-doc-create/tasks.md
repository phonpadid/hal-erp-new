## 1. Backend — selectable-currencies read

- [x] 1.1 Add a `listSelectable()` method to `CurrencyService` that returns only
  `{ code, name, symbol, decimalPlaces }` for `is_active = true` currencies, ordered by `code`
  (use a `fields` projection; do not paginate).
- [x] 1.2 Add `GET /currencies/selectable` to `CurrencyController` gated by
  `@RequirePermissions(DOC_CREATE)`, declared before the `:code` route so `selectable` is not
  captured as a code param.
- [x] 1.3 Reference the `DOC_CREATE` code from the document module's permissions rather than
  redefining it in the currency module (invariant 6 — authorize on codes).

## 2. Backend — tests

- [x] 2.1 Test: a user with `DOC_CREATE` but not `CURRENCY_VIEW` gets the active currencies
  from `GET /currencies/selectable` (guard allows DOC_CREATE; denies BUDGET/CURRENCY_VIEW-only
  and none).
- [x] 2.2 Test: inactive currencies are excluded and each row has only
  `code`/`name`/`symbol`/`decimalPlaces`.

## 3. Frontend — wizard wiring

- [x] 3.1 Add an API call for the selectable-currencies read (in `api/currency.ts`) returning
  `Array<{ code; name; symbol?; decimalPlaces }>`.
- [x] 3.2 Add a `loadSelectableCurrencies()` to the currency store (distinct `selectableCurrencies`
  state from the admin paginated list so the two reads don't clobber each other).
- [x] 3.3 In `CreateDocumentView.vue`, load the selectable currencies instead of the admin list
  and bind the currency `Select` to `selectableCurrencies`; base-currency default unchanged.
- [x] 3.4 (design refinement) Repoint `useCurrencyFormat` to auto-load the picklist instead of
  the `CURRENCY_VIEW` admin list — it is the actual trigger of the wizard's `/currencies` 403 and
  only needs active currencies' decimal places. `decimalPlacesOf` reads `selectableCurrencies`
  first, falling back to the admin list (so admin pages are unaffected).

## 4. Frontend — tests

- [x] 4.1 Test: the store `loadSelectableCurrencies` populates the picker state from the
  selectable read.

## 5. Verify end-to-end

- [x] 5.1 Verified via tests + code: guard allows `DOC_CREATE` without `CURRENCY_VIEW`; the wizard
  and `useCurrencyFormat` now both use `loadSelectableCurrencies` (the only callers of the admin
  `/currencies` in the create path), so the `limit=100` 403 is removed. NOTE: not driven against a
  live running stack this session.
- [x] 5.2 Confirmed the admin currency routes (`GET /currencies` incl. inactive, `:code`,
  create/update/deactivate) are untouched and still gated by `CURRENCY_VIEW`/`CURRENCY_MANAGE`;
  only an additive `selectable` route was added.
- [x] 5.3 `openspec validate` passes; backend currency suite 10/10; new frontend store test passes;
  changed files typecheck clean. Pre-existing, unrelated failures: `create-document-ux` (2, cell-
  edit-mode drift) and `components > fieldComponent` (1, a `formFields` mapping test) — none touch
  this change's code.

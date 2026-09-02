## 1. The column

- [x] 1.1 `PaymentBatch.bankAccount`, nullable.
- [x] 1.2 DBML, with the note on why it is optional.
- [x] 1.3 A migration adding it. No data derived (design D3).

## 2. Building and importing

- [x] 2.1 The build DTO accepts a bank account id; the service refuses one of another company.
- [x] 2.2 `importResult` stamps it onto each payment, beside where `payment.batch` is already set.
- [x] 2.3 A batch with none behaves as before.

## 3. The screen

- [x] 3.1 api + store + a bank-accounts screen: list, create, deactivate.
- [x] 3.2 Controls gated by `BANK_ACCOUNT_MANAGE`; the list by `BANK_ACCOUNT_VIEW`.
- [x] 3.3 Route, nav entry, i18n in three locales, smoke registry.

## 4. Tests

- [x] 4.1 A batch with an account stamps it onto its payments.
- [x] 4.2 A batch without one still records payments, carrying none — asserted separately.
- [x] 4.3 Another company's bank account is refused at build.
- [x] 4.4 Frontend: management controls absent without the code.
- [x] 4.5 Negative check on three behaviours: the stamp removed, the company check dropped, and the
      management controls rendered without their code — each reddens the case that claims it.
- [x] 4.6 `common.inactive` did not exist; the screen uses a key in its own namespace rather than
      widening `common` for one label.

## 5. Checks

- [x] 5.1 `npm test` in `back/`, `nest build`, frontend `test` + `typecheck`; `PIPESTATUS`.
- [x] 5.2 `npm run migration:up` against the real database.
- [x] 5.3 `openspec validate --all` passes.
- [x] 5.4 Do NOT edit `openspec/specs/**` by hand.

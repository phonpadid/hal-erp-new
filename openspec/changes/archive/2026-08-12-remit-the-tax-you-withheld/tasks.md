## 1. The table

- [x] 1.1 `wht_certificate`: company, payment (unique), certificate no, vendor, tax code, rate, base,
      amount, issued on/by, remittance id, remitted on.
- [x] 1.2 `wht_certificate_number`, keyed by company and year — its own table, not
      `doc_running_number`, which is keyed by `document_type` (design D2).
- [x] 1.3 DBML for both, with notes.
- [x] 1.4 `Migration20260818000000` creates both. No data written (design D4).

## 2. Issuing

- [x] 2.1 `WhtService.certify` refuses a zero withholding, a second certificate, and another
      company's payment.
- [x] 2.2 The number is taken under `LockMode.PESSIMISTIC_WRITE` via the shared `lockForUpdate`.
- [x] 2.3 A concurrency case: two issues at once take different numbers.
- [x] 2.4 The rate and the base are STAMPED, not looked up later — a rate edited afterwards must not
      restate a certificate the payee already holds.

## 3. Remitting

- [x] 3.1 The entry debits `WHT_PAYABLE` and credits `CASH_CLEARING` for the SUM OF THE
      CERTIFICATES, through `createEntry`, keyed `(company, WHT_REMITTANCE, remittanceId)`.
- [x] 3.2 Certificates are stamped; already-stamped ones are refused by name.
- [x] 3.3 `SOURCE_WHT_REMITTANCE` beside the other source types.
- [x] 3.4 `outstanding()` returns the unstamped certificates and their total.

## 4. Permissions and endpoints

- [x] 4.1 `WHT_CERTIFY` and `WHT_REMIT`, distinct — handing a payee evidence and moving money to the
      authority are different acts. Both reach the admin role through `allPermissionCodes()`, which
      already folds in `TaxPermissions`; no seed edit was needed.
- [x] 4.2 `GET /wht/outstanding` (TAX_VIEW), `POST /wht/payments/:id/certificate` (WHT_CERTIFY),
      `POST /wht/remittances` (WHT_REMIT).

## 5. The client

- [x] 5.1 api + store + `WithholdingTaxView`: the outstanding certificates, their total, selection,
      and a remit dialog that states the figure the entry will carry.
- [x] 5.2 Amounts through `fmtBase`; the selected total summed with `sumAmounts`. Nav entry in the
      existing `accounting` section.
- [x] 5.3 i18n in `en`, `la`, `zh`; smoke registry entry.

## 6. Tests

- [x] 6.1 All ten backend scenarios: issue, zero, twice, concurrency, cross-company, remit total,
      already-remitted, retry, outstanding, empty remittance.
- [x] 6.2 The remittance entry balances and equals the certificates' total.
- [x] 6.3 Concurrency on the number.
- [x] 6.4 Company isolation on certifying.
- [x] 6.5 Negative check: clearing by a fixed figure instead of the certificates' total, dropping
      the lock, not stamping the remittance, and dropping the already-remitted check each redden the
      cases that claim them. Front-end: the permission gate, the empty-selection guard and `fmtBase`
      each redden theirs.
- [x] 6.6 The first fixture minted its own `WHT3` tax code and hit the seeded one's unique
      `(company, code)`. Reuses the seeded code — a fixture that duplicates seeded data tests the
      fixture.

## 7. Checks

- [x] 7.1 Backend 1423 passed / 36 skipped (was 1413); frontend 89 files / 777 tests (was 88/769);
      `nest build` and `typecheck` clean.
- [x] 7.2 `npm run migration:up` applied `Migration20260818000000` against the real database.
- [x] 7.3 `openspec validate --all` passes.
- [x] 7.4 `openspec/specs/**` untouched.

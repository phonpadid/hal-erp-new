## 1. The tax point

- [x] 1.1 Submit refuses `tax_total > 0` on a type that REQUIRES A PAYEE and does not accrue on
      approval (design D1) — not on carrying VAT alone, which would refuse a requisition's estimate.
- [x] 1.2 The refusal names the type's configuration as the fix, not the document.
- [x] 1.3 The existing invoice-number rule stays as it is — it already applies to exactly the
      accruing types, which are now the only ones that can carry VAT.

## 2. The receivable

- [x] 2.1 `AccountRoleType.VAT_RECEIVABLE`, in the enum and the DBML.
- [x] 2.2 A seeded `1320 VAT Receivable` account and its role mapping.
- [x] 2.3 A migration widening the `account_role` check constraint to admit it.

## 3. The return

- [x] 3.1 `vat_return`: company, period from/to, amount, filed on/by, entry key.
- [x] 3.2 `file(from, to)` reads the period's `VAT_INPUT` net movement from the ledger (design D3),
      refuses zero, refuses a period already filed, and posts
      `Dr VAT_RECEIVABLE / Cr VAT_INPUT` keyed `(company, VAT_RETURN, returnId)`.
- [x] 3.3 `SOURCE_VAT_RETURN` beside the other source types.
- [x] 3.4 A read of the filed returns, company-scoped.
- [x] 3.5 `VAT_FILE` permission, distinct from `TAX_VIEW`.

## 4. The client

- [x] 4.1 api + store + the VAT summary screen gains the filed state and a file control.
- [x] 4.2 Amounts through `fmtBase`; i18n in three locales.

## 5. Tests

- [x] 5.1 Submit refuses a VAT document on a non-accruing type, and accepts one on an accruing type
      — both asserted, since a check that always fires would pass the first alone.
- [x] 5.2 A no-VAT document on a non-accruing type still submits.
- [x] 5.3 Filing posts the two lines for the period's movement.
- [x] 5.4 A period filed twice is refused.
- [x] 5.5 A retried filing posts once.
- [x] 5.6 A period with no input VAT is refused.
- [x] 5.7 Company isolation on the read.
- [x] 5.8 Each new test must fail with its feature removed. Check it.

## 6. Checks

- [x] 6.1 `npm test` in `back/`, `nest build`, frontend `test` + `typecheck`; `PIPESTATUS`.
- [x] 6.2 `npm run migration:up` against the real database.
- [x] 6.3 `openspec validate --all` passes.
- [x] 6.4 Do NOT edit `openspec/specs/**` by hand.

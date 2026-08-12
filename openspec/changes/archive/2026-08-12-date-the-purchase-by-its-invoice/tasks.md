## 1. The columns

- [x] 1.1 `document.vendorInvoiceNo` (varchar, nullable) and `vendorInvoiceDate` (date, nullable).
- [x] 1.2 `erp_approval_system.dbml` — both, with notes.
- [x] 1.3 `Migration20260817000000` adds both, nullable, no data change.

## 2. Submit

- [x] 2.1 The create DTO accepts both, optional.
- [x] 2.2 Submit rejects a document that carries VAT **and whose type accrues on approval** and is
      missing either.
      The rule shipped in the first draft was `tax_total > 0` alone, and two existing tests failed
      against it — correctly. A purchase requisition carries a tax code to estimate a purchase's
      cost, and nobody has the supplier's invoice when raising one; the seeded chain says the
      disbursement IS the accepted invoice while a PR and a PO are commitments. The narrowed rule is
      exactly the set of documents whose accrual posts input VAT and is dated by the invoice, so the
      requirement asks for the data where the system consumes it. Design D2 and the spec were
      rewritten to match.
- [x] 2.3 The refusal names which of the two is missing.
- [x] 2.4 Not in the plan: `PATCH /documents/:id/invoice` and `setVendorInvoice`. The document
      service has no general update — fields, lines and payee each have their own endpoint — and a
      draft is usually raised before the invoice arrives, so creation-only capture would have made
      the field unusable. DRAFT-only, mirroring the payee: the invoice a document claims against is
      part of what the approvers saw.

## 3. The accrual's date

- [x] 3.1 The accrual is dated `vendorInvoiceDate` when that date's period is OPEN, `approvedAt`
      otherwise (design D3).
- [x] 3.2 The open/closed question goes to `PeriodGuardService.closedPeriodOn`.
- [x] 3.3 The memo names the invoice when it was used, and says which closed period pushed the entry
      to the approval date when it was not.
- [x] 3.4 A document with no invoice date behaves exactly as before.
- [x] 3.5 The instant is built at midday, like the manual voucher's, so resolving to the company's
      calendar day cannot land on a neighbouring one.

## 4. The stale rule

- [x] 4.1 The DBML note no longer forbids combining `accrues_on_approval` with `requires_payee`, and
      says why the two are now safe together.
- [x] 4.2 The same correction in the submit-config DTO comment.
- [x] 4.3 No validator added — the seeded `DISB` uses the combination deliberately, and one would
      have broken every disbursement in the reference configuration.

## 5. The form

- [x] 5.1 `CreateDocumentView.vue` captures both in the lines step — the step where a line gains a
      tax code and the requirement becomes true.
- [x] 5.2 Gated on the same rule the server applies: an accruing type with a taxed line.
- [x] 5.3 i18n in `en`, `la` and `zh`.
- [x] 5.4 Not in the plan: `creatableTypes` had to start returning `accruesOnApproval`, because the
      form could not otherwise apply the server's rule. `CreatableType` declares it required rather
      than optional, which is what made `typecheck` point at the two test fixtures that needed it.

## 6. Tests

- [x] 6.1 A claiming document is refused without the number, then without the date, then accepted —
      one case walking the whole rule, which also exercises the new endpoint.
- [x] 6.2 The same case asserts a requisition carrying tax submits with neither field. Asserted
      together on purpose: the point of the rule is the difference between the two.
- [x] 6.3 The accrual is dated the invoice date, and the memo names the invoice.
- [x] 6.4 A closed invoice month falls back to the approval date, and the memo says which period
      pushed it.
- [x] 6.5 Documents with no invoice date are covered by the existing accrual cases, which still pass
      untouched.
- [x] 6.6 Negative check on four behaviours: the invoice date ignored, the closed-period fallback
      removed, the requirement removed, and the requirement widened back to every taxed document —
      the last reddens 3 cases, which is how the over-wide rule was caught in the first place.

## 7. Checks

- [x] 7.1 Backend 1413 passed / 36 skipped; frontend 88 files / 769 tests; `nest build` and
      `typecheck` clean, exits read with `PIPESTATUS`.
- [x] 7.2 `npm run migration:up` applied `Migration20260817000000` against the real database.
- [x] 7.3 `openspec validate --all` passes.
- [x] 7.4 `openspec/specs/**` untouched.

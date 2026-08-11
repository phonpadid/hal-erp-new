# Design

## D1. The ledger is the source, so the report cannot disagree with the books

Two places currently hold "the input VAT for July": `document.base_tax_total` summed by submission
month, and the `VAT_INPUT` account's debits. They are computed from different rows on different
dates, so they drift by construction — and the one that gets filed is the one that is not the books.

Reading from `journal_line` removes the second number rather than reconciling it. This is the
property `openPayables` already has, and its comment says why: *"derived, not stored … a derived
read cannot drift from the journal because it is read from it."*

It also fixes the tax point for free where the ledger has it right. Input VAT is debited when the
accrual is posted, and the posting code states the reason: *"its tax point is the invoice date, so
debiting it at payment reports a December invoice paid in January in January's return."* The report
inherits that. Where the ledger has the tax point wrong — see the proposal's finding — the report
now shows the wrong figure honestly instead of a different wrong figure.

**Movement, not balance.** Per period, the figure is `Σ debit − Σ credit` on the role's account. A
reversal credits `VAT_INPUT` and reduces that month's claim, which is what a cancelled invoice
should do. A manual voucher that adjusts input VAT appears in the return, which is what an
accountant posting an adjustment intends. Both fall out of reading the ledger; neither was possible
before.

## D2. The timezone bug is removed, not fixed

`journal_entry.entry_date` is a `date` column holding a company-day, resolved once by `createEntry`
through `localDateIn`. Its month is the first seven characters of a string.

So the period becomes `entryDate.slice(0, 7)` on a value that was never an instant. There is no
timezone to get wrong, no `Date` to construct, and no second place where the company's calendar has
to be understood. The alternative — keeping `document`/`payment` as the source and calling
`localDateIn` on their timestamps — would fix today's bug and leave the mechanism that produced it.

## D3. An unmapped role reports nothing, and does not fail

`AccountRoleService.resolve` throws `UnmappedAccountRoleError` when a role is unmapped, which is
right for a posting: an entry that cannot resolve its account must not be written.

A report is the opposite case. A company that has never mapped `WHT_PAYABLE` has never withheld
anything, and the honest answer is zero — not a 500 on a screen that also shows VAT. So this reads
the mapping with `findOne` and treats absence as "no rows", the way `openPayables` treats an
unmapped `ACCOUNTS_PAYABLE`.

## D4. Company scope through the same seam as the rest of the file

`vatSummary` is the only method in `TaxService` that does not call
`companyScope.forActiveCompany()`. It reaches for `RequestContext.companyId()` without the non-null
assertion its neighbours use, disables the company filter, and then re-adds it by hand — with a
fallback that returns every company's tax when the context is missing.

The fix is to stop being the exception. `forActiveCompany()` applies the filter the ORM already
knows how to apply, and a missing context fails there rather than silently widening. This is not
defensive coding for a case that happens; it is removing a default that is wrong in the direction
that matters (invariant 1).

## D5. The response shape does not change

`{ period, vat, wht }[]` stays. The client's `VatSummaryRow` and the store need no edit, and the
screen's only change is formatting.

This is deliberate. A change whose whole claim is "these numbers were wrong and are now right" is
much easier to review when the shape is identical and the diff is the derivation. Columns that a
tax settlement will want — the outstanding balance, the amount already remitted — arrive with the
change that can act on them.

## D6. Formatting on the screen, not in the service

The service returns decimal strings, as every money-carrying endpoint does. `TaxSummaryView`
currently renders them raw, so `1000` shows as `1000` where the rest of the app shows `1,000.00`.

`fmtBase` is the same call the journal, the balance sheet and the payables list use, and it takes
the base currency's own `decimal_places` rather than assuming two — which matters for a report
whose figures a person copies onto a return.

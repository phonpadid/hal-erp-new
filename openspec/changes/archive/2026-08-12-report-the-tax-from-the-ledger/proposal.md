# Report the tax from the ledger

## Why

`TaxService.vatSummary` (`back/src/modules/tax/tax.service.ts:106-135`) is the number a company
files its monthly return on. It has three defects, and it is the only method in its own file that
departs from the file's pattern on all three counts.

**It bins the month in UTC.**

```ts
const period = (d.submittedAt ?? d.createdAt)?.toISOString().slice(0, 7)   // line 122
const period = (p.paidAt   ?? p.createdAt)?.toISOString().slice(0, 7)      // line 127
```

This is the defect the posting engine was corrected for earlier in this work — `entryDateFor` now
resolves an instant in the company's timezone through `localDateIn`. These two lines are the only
remaining `toISOString().slice(0, 7)` in the codebase, and they are in the one report where the
month is the entire point. For a company at UTC+7, everything paid in the first seven hours of a
month is filed in the previous month's return.

**It reads documents and payments, not the ledger.** The GL debits `VAT_INPUT` when the accrual is
posted — at the invoice, whose date is the tax point, as the posting code says in as many words.
This report bins by `submitted_at`, the date the document was raised. So "July's input VAT" has two
values that do not match, and the one that is filed is not the one the books hold.

**It falls back to every company.** Lines 111 and 116 read
`companyId ? { company: companyId } : {}` under `FILTER_OFF`, which disables the automatic company
filter. Every other method in `TaxService` goes through `companyScope.forActiveCompany()`. A missing
company context should yield nothing, not everything (invariant 1).

And on the screen, `TaxSummaryView` renders `data.vat` and `data.wht` as the raw strings the server
sent, without the base currency's `decimal_places` — the same class of defect as the journal's
entry total, fixed in the voucher change.

This is the correctness work that has to land before the monthly tax settlement can be built on top
of it: a remittance that clears `WHT_PAYABLE` has to agree with the figure that was filed.

## What Changes

- `vatSummary` derives both figures from `journal_line`, by account role — `VAT_INPUT` for input
  VAT, `WHT_PAYABLE` for withheld tax — instead of from `document.base_tax_total` and
  `payment.wht_amount`.
- The period becomes the month of `journal_entry.entry_date`, which is already a company-day string.
  The timezone bug does not get fixed so much as removed: there is no instant left to convert.
- Company scope through `companyScope.forActiveCompany()`, like the rest of the file.
- An unmapped role yields no figures rather than an error, following `openPayables`.
- `TaxSummaryView` formats both amounts through `fmtBase`.

## What This Change Does NOT Do

- No remittance, no settlement, no clearing of either balance. That is the next change, and it is
  the reason this one exists first.
- No outstanding-balance column. What you file is the period's movement; what you owe is the
  balance, and it belongs with the act that pays it.
- No new endpoint, no permission change. `GET /tax-codes/vat-summary` stays under `TAX_VIEW`: it
  reports aggregated tax figures, which is what that code is for, and reading them from the ledger
  rather than from documents does not change who should see them.

## A finding this change reports rather than fixes

The tax point for input VAT is inconsistent in the ledger itself, and moving the report onto the
ledger inherits that inconsistency rather than creating it:

- a document type with `accrues_on_approval` true debits `VAT_INPUT` at the accrual — the invoice
  date, which is the correct tax point and what the code comment claims;
- a type with it false debits `VAT_INPUT` at payment (`gl-posting.service.ts:509`), so its tax point
  is the payment date.

Two documents with the same invoice date can therefore fall in different returns depending on a
`document_type` flag that was set for an unrelated reason. Reading from the ledger makes the report
agree with the books, which is this change's job; making the books agree with the tax law is a
separate change, and it should be a decision rather than a side effect.

## Impact

- Affected specs: `purchase-tax`, `web-accounting`
- Affected code: `back/src/modules/tax/tax.service.ts`, `back/src/modules/tax/tax.module.ts`
  (the role lookup), `front-end/src/views/TaxSummaryView.vue`
- No migration. No API shape change.

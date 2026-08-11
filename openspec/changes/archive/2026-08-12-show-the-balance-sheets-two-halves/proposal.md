# Show the balance sheet's two halves

## Why

The year-end close made retained earnings two different numbers, and the balance sheet screen shows
only one of them.

`FinancialReportsService.balanceSheet` returns both:

- `retainedEarningsBroughtForward` — what closed years rolled into the equity account. A balance,
  read from the account itself. Already inside `equityTotal`.
- `retainedEarnings` — the current period's result, derived as revenue − expense over whatever
  still stands. After a year closes, only the open periods remain in it. Added to the total.

`front-end/src/api/financialReports.ts` types only the second, so `BalanceSheetReport.vue` renders
only the second — under the label `Retained earnings (current period)`, correct as far as it goes,
beside an explanatory note that is now false in all three languages:

> Retained earnings is derived (cumulative revenue − expense); **no period close has rolled it into
> equity.**

A close now does exactly that. The screen tells the reader the opposite of what the system does.

The brought-forward figure is not invisible — it sits in the equity table as an ordinary account
row. That is the problem, not the consolation: an account named "Retained Earnings" in the table and
a line named "Retained earnings" below it, one of which is already counted and one of which is not,
with nothing on the screen saying which is which.

## What Changes

- `BalanceSheet` in the api types gains `retainedEarningsBroughtForward`.
- The balance sheet screen names both halves and marks the brought-forward one as already counted in
  the equity table above, so no reader adds it twice.
- The note stops claiming no close has happened and explains the split instead.
- Three locales, because `en`, `la` and `zh` carry identical file sets.

No backend change. No arithmetic change on either side — `liabilitiesEquityTotal` and `balanced`
already account for both figures correctly and are not touched.

## Capability

The financial-statement screens (`TrialBalanceReport`, `BalanceSheetReport`, `IncomeStatementReport`,
`AccountLedgerReport`) have no owning `web-*` capability — no existing spec mentions a balance sheet
or a trial balance. This change starts `web-accounting` with the one requirement it can honestly
state today. Bringing the other accounting screens under it is separate work.

## Impact

- Affected specs: `web-accounting` (new)
- Affected code: `front-end/src/api/financialReports.ts`,
  `front-end/src/views/reports/BalanceSheetReport.vue`,
  `front-end/src/i18n/locales/{en,la,zh}/reports.ts`
- Not affected: `back/src/modules/gl/financial-reports.service.ts` — it already returns both figures

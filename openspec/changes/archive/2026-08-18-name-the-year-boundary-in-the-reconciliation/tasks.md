## 1. The cause

- [x] 1.1 Depends on `date-every-budget-row`: without `budget_txn.txn_date` the cause is not
      computable at all. Do not start before it lands (design D5).
- [x] 1.2 Aggregate, per account, the `ACTUAL` rows on the year's budgets whose `txn_date` falls
      outside `[fy.startDate, fy.endDate]`, split into two signed figures — dated before the year
      and dated after it (design D2).
- [x] 1.3 Only `ACTUAL`. `consumed` is `Σ ACTUAL`, so only `ACTUAL` can move the figure being
      reconciled; a `RESERVE` outside the year affects `committed`, which nothing posts against.
- [x] 1.4 Add the term to the existing arithmetic:
      `unexplained = difference − sourcesWithoutBudgetTotal + capitalisedIntoStock
      + postingNeverArrived + consumedOutsideItsYear`, with the sign following the others.
- [x] 1.5 The budget side keeps selecting by `budget.fiscal_year` — NOT re-bounded by `txn_date`.
      Write the reason in the code: bounding it would drop a crossing row from both years' reports
      and let the reconciliation balance by losing the evidence (design D3).

## 2. The documents behind it

- [x] 2.1 Each figure carries its contributing documents: document number, the day the consumption
      was dated, and the amount — the shape `VoucherOnBudgetedAccount` already uses.
- [x] 2.2 Capped and counted, like every other list in these reports.

## 3. Frontend

- [x] 3.1 The reconciliation view shows the new cause beside the existing ones, with its two signed
      figures, and the document list behind them.
- [x] 3.2 i18n in the three locales, including a line saying what the figure means: money charged to
      one year's budget on a day the ledger posted into another.
- [x] 3.3 The screen behaviour needs a spec of its own. Added a `web-accounting` delta at archive
      time: the expansion names the documents behind a crossing, and a capped list states how many
      it did not show. The second rule had shipped with no test — a truncated list that stays quiet
      reports a smaller problem than the one that exists — so the test came with the spec.

## 4. Tests

- [x] 4.1 A document that reserved in December and settled in January is explained by the cause, and
      the unexplained remainder is zero — the case the whole change exists for.
- [x] 4.2 Early and late crossings of equal amount are reported as two figures, not netted away.
- [x] 4.3 A crossing row is still counted in `consumed` for the year of its appropriation — the
      report explains it rather than dropping it.
- [x] 4.4 An account with no crossings reports zero for the cause and an unchanged remainder.
- [x] 4.5 The existing causes and the existing remainder arithmetic are unchanged for every case
      that has no crossing.
- [x] 4.6 Each new test must fail with its feature removed. Check it.

## 1b. Found while implementing

- [x] 1b.1 The cause OVERLAPS the two per-document causes: a crossing document has no journal entry
      inside the year, so `postingNeverArrived` claims the same money and the remainder lands at the
      crossing's value instead of zero. The crossing is now subtracted from what those causes see,
      BY AMOUNT so a document settled either side of the boundary splits correctly. Design D2b and
      the spec were updated before the code (design D2b).

## 5. Checks

- [x] 5.1 `npm test` in `back/`, `nest build`, frontend `test` + `typecheck`; `PIPESTATUS`.
      back: 1556 passed (+5 from this change), 1 failed — `attendance-period.service.spec.ts`, the
      pre-existing time bomb pinning `2026-07-15` against a 30-day correction window. Attendance is
      untouched here. `nest build` clean; front-end 811 tests (+2) and `vue-tsc` clean.
- [x] 5.2 No migration — this change reads. No new file under `back/src/migrations`.
- [x] 5.3 `openspec validate --all` passes.
- [x] 5.4 Do NOT edit `openspec/specs/**` by hand. The changed files there are the seven prior
      archive syncs, untouched by this change.

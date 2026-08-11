## 1. The role

- [x] 1.1 `back/src/common/enums/index.ts` and `erp_approval_system.dbml` — `RETAINED_EARNINGS` in
      `account_role_type`, noted as the equity account a year's result is rolled into so revenue and
      expense begin the next year at zero.
- [x] 1.2 `back/src/seed/seed-data.ts` — a `3200 Retained Earnings` EQUITY account and its role
      mapping. Its own account, like every other role.

## 2. The closing entry

- [x] 2.1 `back/src/modules/gl/year-close.service.ts` (new) — for one fiscal year: aggregate
      `journal_line` over the year's `entry_date` range, per account, for REVENUE and EXPENSE only.
- [x] 2.2 Close by BALANCE, one line per account, not by replaying transactions (design D2). A year
      may hold a hundred thousand lines and three dozen accounts; the entry that zeroes them needs
      three dozen lines. An account with no activity contributes nothing rather than a zero line.
- [x] 2.3 Debit each revenue account for its credit balance, credit each expense account for its
      debit balance, and put the difference to `RETAINED_EARNINGS` — a credit for a profit, a debit
      for a loss. Post through `createEntry` like everything else, keyed
      `(YEAR_CLOSE, fiscalYearId)` so it cannot post twice (design D3).
- [x] 2.4 A year with no revenue and no expense activity posts nothing. There is no result to roll.
- [x] 2.5 `SOURCE_YEAR_CLOSE` beside the other source types in `gl-posting.service.ts`. No posting
      path changes.

## 3. Closing the year with its final period

- [x] 3.1 `accounting-period.service.ts` — in `close`, after the accrual and **before** either
      status is set: if `period.periodEnd` equals the fiscal year's `endDate`, post the closing
      entry and set `fiscal_year.status` to `CLOSED`.
- [x] 3.2 **Order matters and the comment must say why.** The closing entry is dated the year's last
      day, which is inside the period being closed; running it after that period is closed means
      `createEntry` refuses it — correctly (design D1). This placement is the only one that needs no
      exception to the period guard.
- [x] 3.3 A period that is not the year's last changes nothing about the year.
- [x] 3.4 A company with no declared periods reaches none of this. `FiscalYearService.close()` stays
      exactly as it is — the flag it always was, posting nothing (design D5).

## 4. The reports say what they now mean

- [x] 4.1 `financial-reports.service.ts` — `balanceSheet` reports the `RETAINED_EARNINGS` account's
      own balance separately from the derived current-period figure.
- [x] 4.2 **Change no arithmetic.** The derived figure and the balance check are already correct
      after a close: a closed year's revenue and expense net to zero, so the derivation narrows to
      the open periods by itself, and the closed result is inside `equityTotal` because it lives in
      an equity account (design D4). If this task starts editing the sums, stop and re-read D4.

      **Held.** `netIncome`, `equityTotal` and the balance check are byte-for-byte unchanged; the
      only addition is reading the retained-earnings account's own balance for the new field. The
      balance-sheet test after a year close passes with the same `balanced` assertion it always
      had — which is the evidence that D4 was right rather than merely plausible.
- [x] 4.3 Update the capability Purpose, which still says there is no period close.

      **Not expressible as a requirement delta** — the Purpose paragraph sits outside every
      `### Requirement` block, so `/opsx:archive`'s sync cannot carry it. It is edited directly in
      `openspec/specs/financial-reports/spec.md` at sync time, and this note exists so that the edit
      is deliberate rather than a stray change in the diff.

## 5. Tests

- [x] 5.1 Closing the year's final period posts a closing entry dated the year's last day and sets
      `fiscal_year.status` to `CLOSED`.
- [x] 5.2 A profit: revenue 500,000 and expense 300,000 produce a debit to revenue, a credit to
      expense, and a 200,000 credit to `RETAINED_EARNINGS`.
- [x] 5.3 A loss: the difference is DEBITED to `RETAINED_EARNINGS`. Assert this separately — a sign
      error here is invisible in a balanced entry.
- [x] 5.4 Closing a period that is not the year's last writes no closing entry and leaves the year
      `OPEN`.
- [x] 5.5 A year with no revenue or expense activity closes with no entry.
- [x] 5.6 Reopening the final period and closing it again leaves exactly one closing entry.
- [x] 5.7 An unmapped `RETAINED_EARNINGS` refuses the close and leaves BOTH the period and the year
      as they were. Assert both — a half-applied close is the failure this ordering exists to avoid.
- [x] 5.8 After a close, the year's revenue and expense accounts net to zero over that year's range,
      which is the property the whole entry exists to create.
- [x] 5.9 The balance sheet still balances after a year close, and reports the brought-forward figure
      separately from the current period's.
- [x] 5.10 Existing suites stay green — 1389 backend tests today. Every period-close case that
      predates this must pass unchanged, including the ones whose periods do not end a fiscal year.

      **Result:** `npx vitest run` — **1396 passed, 36 skipped, 0 failed** (134 files), up from 1389
      by the seven cases added here. `nest build` clean.

      Two existing specs needed the new constructor argument and nothing else. Both had one case
      that failed first — the one whose period happens to end on the fiscal year's last day, which
      is now the case that closes the year. No assertion changed.

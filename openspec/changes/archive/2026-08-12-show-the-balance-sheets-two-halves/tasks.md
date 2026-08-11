## 1. The type

- [x] 1.1 `front-end/src/api/financialReports.ts` — `retainedEarningsBroughtForward: string` on
      `BalanceSheet`, beside `retainedEarnings`. A comment records which of the two is already inside
      `equityTotal`, because the field name does not say so (design D1). Both fields are commented,
      not just the new one — the existing field was equally silent about being a term of its own.

## 2. The screen

- [x] 2.1 `front-end/src/views/reports/BalanceSheetReport.vue` — render the brought-forward figure
      above the current-period one, under the equity table, marked as already counted in the rows
      above (design D1). Muted styling separates the already-counted line from the one that adds.
- [x] 2.2 The current-period line keeps its existing label and value. No client-side arithmetic:
      `liabilitiesEquityTotal` and `balanced` stay exactly as the server returns them.
- [x] 2.3 Zero is rendered, not hidden (design D2).
- [x] 2.4 Amounts go through `fmtBase` like every other figure on the screen — base-currency
      `decimal_places`, never a JS number.
- [x] 2.5 Not in the original plan: `data-testid="retained-brought-forward"` and
      `data-testid="retained-current-period"` on the two lines. Required by 5.1 — see the note
      there. `data-testid` is an existing convention in this codebase (19 views use it).

## 3. The note

- [x] 3.1 Replace `derivedNote`, which claims "no period close has rolled it into equity" — false
      since the year-close change shipped. The replacement describes the two figures and their
      relationship to the equity total, and makes no claim about whether a close has happened
      (design D3).

## 4. Three locales

- [x] 4.1 `front-end/src/i18n/locales/en/reports.ts` — `retainedBroughtForward`, `includedAbove`, and
      the rewritten `derivedNote`.
      NOT done: relabelling `retainedEarnings`. The task made it conditional on the pairing reading
      better, and it does not — `(current period)` / `(brought forward)` already pair in the
      parenthetical style all three locales use. Leaving it alone keeps the diff to added keys.
- [x] 4.2 `front-end/src/i18n/locales/la/reports.ts` — the same keys in Lao, following the accounting
      vocabulary already in the file (`ກຳໄລສະສົມ`), not English (design D4).
- [x] 4.3 `front-end/src/i18n/locales/zh/reports.ts` — the same keys in Chinese, following `留存收益`.
- [x] 4.4 Verified: 166 keys, `en`/`la`/`zh` key sets identical by `diff`.

## 5. Test

- [x] 5.1 `front-end/src/views/reports/BalanceSheetReport.spec.ts` (new) — mounted with brought
      forward at `183,000` and the current period at `17,000`, both asserted.
      The first draft asserted `w.text()).toContain('183,000.00')` and passed **before the screen
      change existed**: the brought-forward amount is also the equity table's Retained Earnings row,
      so the page text contains it either way. Counting occurrences fails too — `'0.00'` is a
      substring of `'540,000.00'`. Hence the test ids in 2.5, and each figure is read from its own
      element.
- [x] 5.2 A second case with brought forward at zero asserts the line still exists (design D2).
- [x] 5.3 Follows `TrialBalanceReport.spec.ts`: `mountView`, `permissions: ['GL_VIEW']`,
      `initialState.financialReports`.
      One assertion does read a locale string — the "included above" marker, which is the whole point
      of the requirement and cannot be asserted as data. It is resolved through
      `i18n.global.t(...)`, not hardcoded: the app's default locale is `la`, and a hardcoded English
      string failed against the Lao render.
- [x] 5.4 Not in the original plan: a fourth case pinning `liabilitiesEquityTotal` to the server's
      value, so a future edit that adds brought forward into a client-side total is caught.
- [x] 5.5 Negative check: with the new lines removed from the view, 3 of the 4 cases fail. The fourth
      is green either way by design — it asserts the total does NOT move.

## 6. Checks

- [x] 6.1 `npm run test` — 83 files, 709 tests, all passing. The typecheck script is `typecheck`,
      not `type-check`; `npm run typecheck` (vue-tsc) is clean. There is no `lint` script in
      `front-end/package.json`.
- [x] 6.2 `openspec validate --all` — 72 passed, 0 failed.
- [x] 6.3 `openspec/specs/**` untouched (`git status --porcelain openspec/specs/` empty) — the delta
      under this change's `specs/` is the deliverable, and `/opsx:archive` syncs it.

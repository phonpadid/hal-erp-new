## 1. The derivation

- [x] 1.1 `back/src/modules/tax/tax.service.ts` — `vatSummary` reads `journal_line` with its entry
      populated, restricted to the accounts mapped to `VAT_INPUT` and `WHT_PAYABLE`, instead of
      reading `Document.baseTaxTotal` and `Payment.whtAmount` (design D1). Both entity imports are
      gone, and so is the file's now-unused `FILTER_OFF`.
- [x] 1.2 Per period, per role — but NOT both as `Σ debit − Σ credit`, as the task said.
      Input VAT is an asset and is debited; withheld tax is a liability and is CREDITED. Taking both
      the same way reported every month's withholding as a negative number. Each is now taken in the
      direction its account naturally moves. Caught while writing the code, not by a test — a sign
      error is invisible in an entry that still balances, which is the same trap the year-close
      change documented. The spec delta was corrected to state both directions, and a scenario and
      test were added for the positive WHT figure.
- [x] 1.3 The period is `journalEntry.entryDate.slice(0, 7)` — a company-day string, not an instant
      (design D2). No `Date` is constructed.
- [x] 1.4 Role lookup with `find` on `AccountRole` for both roles at once, not
      `AccountRoleService.resolve`: an unmapped role reports nothing rather than throwing
      (design D3).
- [x] 1.5 Checked rather than assumed: `tax.module.ts` needs NO change. `forFeature([TaxCode])`
      provides a repository; the injected `EntityManager` already queries any entity registered with
      the ORM, which is how `JournalService` reads `AccountRole` from its own module.

## 2. The company scope

- [x] 2.1 `vatSummary` goes through `companyScope.forActiveCompany()` like the other seven methods in
      the file. The `companyId ? {...} : {}` fallback and the `FILTER_OFF` reads are gone
      (design D4, invariant 1).
- [x] 2.2 Checked: no other method in `TaxService` carries that fallback — `vatSummary` was the only
      one, and `FILTER_OFF` is no longer referenced anywhere in the file.

## 3. The shape

- [x] 3.1 The response stays `{ period, vat, wht }[]`, sorted by period (design D5). No client type
      change, no store change.

## 4. The screen

- [x] 4.1 `front-end/src/views/TaxSummaryView.vue` — both amounts through `fmtBase` (design D6),
      with `data-testid` on each so the test reads a figure rather than the page.

## 5. Tests

- [x] 5.1 A new DB-backed `vatSummary` suite in `tax.service.spec.ts`: an entry dated in month M
      reports its input VAT in M.
- [x] 5.2 The timezone case.
      The first version did not discriminate: it dated an entry `2026-08-01` and asserted August,
      which every implementation passes — the old code read documents and payments, so this fixture
      could not be run against it at all. Rewritten to give the row a `createdAt` of
      `2026-07-31T17:30:00Z` against a company-day of `2026-08-01`: the exact window that used to be
      misfiled. Verified by re-binning on `createdAt.toISOString()` and watching the case fail.
- [x] 5.3 A reversal reduces the period it is dated in (August reports −1000), not the period of the
      entry it reverses (July still reports 1000).
- [x] 5.4 An unmapped role reports zero without throwing — company B has `VAT_INPUT` mapped and
      `WHT_PAYABLE` unmapped, so one summary exercises both halves.
- [x] 5.5 Company isolation: A sees 100, B sees 999, for the same period.
- [x] 5.6 The summary equals the account's net movement, computed from the ledger in the test rather
      than restated from the implementation.
- [x] 5.7 `TaxSummaryView.spec.ts` (new): raw `1000` renders `1,000.00`, raw `3000.5` renders
      `3,000.50`.
- [x] 5.8 Negative check run for five behaviours, each by breaking the code and confirming the
      matching case goes red: WHT taken as `debit − credit`; an unmapped role throwing; the company
      scope removed (7 cases red); the period binned on a UTC timestamp; and `fmtBase` removed from
      the screen.

## 6. Checks

- [x] 6.1 `npm run test` + `npm run typecheck` in `front-end/` — 88 files, 766 tests, clean.
      Backend `npm test` run and reported below.
- [x] 6.2 `nest build` clean.
- [x] 6.3 `grep -rn "toISOString().slice(0, 7)" back/src` returns two hits, BOTH in prose — the doc
      comment on `vatSummary` and a test comment, each naming the old behaviour to explain what the
      case pins. No executable occurrence remains.
- [x] 6.4 `openspec validate --all` passes.
- [x] 6.5 `openspec/specs/**` untouched.

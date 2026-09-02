## 1. The revaluation

- [x] 1.1 `FxRevaluationService.outstanding(companyId, asOf)` returns each open foreign-currency
      payable with its carried amount, its foreign amount, the revalued amount and the difference.
- [x] 1.2 Open payable is the derivation `JournalService.openPayables` states — an approval accrual
      crediting `ACCOUNTS_PAYABLE` with no payment for the same source — read the same way rather
      than re-derived.
- [x] 1.3 Foreign only. NOT NEEDED, and this is the interesting part: `document` already carries its
      currency, its locked rate and its own-currency total, so the `ap_open_item` table an earlier
      analysis called a prerequisite was never required.
- [x] 1.4 `resolveRate(..., asOf: period.periodEnd)`. Its refusal propagates unchanged.
      The design's first wording said "no rate on that date"; `resolveRate` resolves the latest rate
      at or BEFORE the date, which is what a closing rate is — a company does not publish one every
      day. Corrected in the design and the spec rather than the code bent to match the prose.

## 2. The entries

- [x] 2.1 One entry dated the period end: the payable moves by the difference, and the net goes to
      `FX_LOSS` when the liability grew or `FX_GAIN` when it shrank.
- [x] 2.2 The reversal, dated the day after, in the SAME operation.
- [x] 2.3 `SOURCE_FX_REVALUATION` / `SOURCE_FX_REVALUATION_REVERSAL`, keyed by the period.
- [x] 2.4 Nothing to retranslate posts nothing.
- [x] 2.5 A payable whose difference is zero contributes no line.

## 3. The close

- [x] 3.1 Step ③′, between the accrual and the year close, with the comment giving both bounds:
      after the drain because it reads balances, before the year close because FX gain and loss are
      swept into retained earnings.
- [x] 3.2 Already revalued is a no-op, like the accrual.

## 4. Tests

- [x] 4.1 A risen rate: `Dr FX_LOSS`, `Cr AP`.
- [x] 4.2 A fallen rate: `Dr AP`, `Cr FX_GAIN` — asserted separately.
- [x] 4.3 A base-currency payable contributes nothing.
      Asserted on the SERVICE as well as on the absent entry. The entry alone could not distinguish
      it: a base-currency payable resolves at an identity rate, so its difference is zero and the
      posting filter drops it whether or not the currency check runs. Found by the negative check —
      removing the check reddened nothing until the service assertion was added.
- [x] 4.4 A paid payable contributes nothing.
- [x] 4.5 The reversal lands the day after and the payable nets back to what its accrual raised.
- [x] 4.6 Re-closing posts no second pair.
- [x] 4.7 A missing rate refuses the close, names the currency, and leaves the period OPEN with
      nothing posted.
- [x] 4.8 Negative check on five behaviours: the gain/loss direction swapped, the reversal dropped,
      base-currency payables included, paid payables included, and a fallback to the locked rate.
- [x] 4.9 Two fixture faults of mine, both worth recording: the seeded company's base currency is
      not THB and the fixture assumed it — it now reads it from the company; and `reset()` deleted
      periods without their log, which every period now has since declares became loggable.

## 5. Checks

- [x] 5.1 Backend and frontend suites, `nest build`, `typecheck` — reported in the summary.
- [x] 5.2 `openspec validate --all` passes.
- [x] 5.3 `openspec/specs/**` untouched.

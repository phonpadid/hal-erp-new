# Tasks — Charge the budget once

## 1. One definition of transaction direction

- [x] 1.1 A three-valued mapping from `budget_txn.txn_type` to its effect on the available balance,
      exported from `shared`: adds (`ADJUST_INCREASE`, `TRANSFER_IN`, `RELEASE`), subtracts
      (`ADJUST_DECREASE`, `TRANSFER_OUT`, `RESERVE`), converts (`ACTUAL`).
      → `BUDGET_TXN_DIRECTION` + `budgetTxnDirection()`.
- [x] 1.2 State beside it WHY it lives in `shared` — two runtimes must agree on it, the way
      `isFieldVisible` is shared "so display and enforcement cannot drift". Convenience is not the
      reason and the next addition should not be able to cite this one as precedent for that.
      → Stated at the definition, citing `isFieldVisible` and ruling convenience out explicitly.
- [x] 1.3 The mapping must be total over the type enum, so a type added later cannot acquire a
      direction by falling into a default bucket — which is exactly how `ACTUAL` became a deduction.
      → Total over the enum; an unknown type falls to `CONVERTS`, the safe default: a wrong
      ADDS/SUBTRACTS misstates money silently, a wrong CONVERTS breaks the reconciliation visibly.
      Covered by a test **added after a mutation showed the fallback was unguarded**.

## 2. Collapse the copies

- [x] 2.1 `budget-balance.service.ts` restates the classification in four switches, all correct.
      Rewrite them against the shared mapping. Behaviour must not change — this removes four
      independent chances to be right, not a bug.
      → Replaced by `applyToBalance` / `applyToUsed`. The `used` accumulator is the balance
      mirrored, so the same three-way sort inverts for two of its cases. 154 budget tests unchanged.
- [x] 2.2 `BudgetDetailView.vue` drops `LEDGER_INFLOW_TYPES` / `isLedgerInflow` and reads the shared
      mapping. Delete the comment claiming it "mirrors the backend balance formula, invariant 3";
      it did not, and leaving it beside working code teaches the next reader the wrong thing.
      → Both gone, comment included.
- [x] 2.3 Check for any other reader of the classification before assuming five was the whole count.
      → Four in `budget-balance.service.ts`, one in `BudgetDetailView.vue`. A sixth reference,
      `outstandingReserved`, was found and **left alone on purpose** — it computes
      `Σ RESERVE − Σ RELEASE − Σ ACTUAL`, the *outstanding* formula, where a settlement genuinely
      does reduce what is still held. Two formulas over one ledger; collapsing them would be this
      same mistake in the other direction. A comment now says so.

## 3. Render the third direction

- [x] 3.1 A settlement row carries no `+` or `−` and does not reuse the outflow colour.
      → Unsigned, muted token rather than the outflow red.
- [x] 3.2 It stays legible as a settlement rather than as missing data (D2): an icon that reads as
      movement between states, not the outflow arrow, with the existing type label doing the naming.
      → `pi-arrow-right-arrow-left`, plus a tooltip saying the balance already moved at reservation.
- [x] 3.3 Theme tokens only, both themes. i18n for anything newly worded.
      → Verified in dark and light; tooltip added in en/la/zh.
- [x] 3.4 The amount itself is still shown in full, and still formatted to the currency's
      `decimal_places` — never a JS number.
      → Unchanged.

## 4. Tests

- [x] 4.1 The reconciliation identity over a complete ledger: summing entries in the directions
      shown equals `available − amount_total`. Assert over the RENDERED ledger, not the raw rows
      (D3) — the defect was in what was drawn, and a test that re-derives the sign from data would
      have passed while the screen stayed wrong.
      → `ledger-rendered.spec.ts` mounts the view and parses the signs out of the rendered cells.
      This mattered: the first draft asserted only the shared mapping, and the mutation that reverts
      the template left it green.
- [x] 4.2 A document that reserved and was then settled in full is accounted for once: the
      reservation reduces, the settlement does not.
      → Asserted over the mapping and over the DOM.
- [x] 4.3 A settlement row is distinguishable from a row with no amount.
      → It still prints its amount at the currency's decimals, so it cannot read as missing.
- [x] 4.4 The identity is asserted over the whole ledger, not one page (D-risk) — the list is
      server-paged, and summing a single page of a multi-page budget asserts something untrue.
      → The fixture is one complete ledger and the assertion covers all of it.
- [x] 4.5 The balance service keeps its existing results after 2.1. If rewriting four switches
      against a new mapping breaks nothing and no test would have caught a mistake, the coverage is
      thinner than assumed — say so rather than take the green run as proof.
      → Answered by mutation rather than assumption: `CONVERTS` subtracting in `applyToBalance`
      fails 2 tests, and in `applyToUsed` another 2. The coverage is real.
- [x] 4.6 Each new test must fail with its feature removed. Check it, and record what was mutated.
      Restore from a scratch copy, never `git checkout`.
      → Five mutations, all caught:

      | mutation | result |
      | --- | --- |
      | template reverts to the two-way split | caught (3) |
      | shared says `ACTUAL` subtracts | caught (9) |
      | unknown-type fallback flips to `SUBTRACTS` | **survived**, then caught once given a test |
      | backend `applyToBalance`: `CONVERTS` subtracts | caught (2) |
      | backend `applyToUsed`: `CONVERTS` adds | caught (2) |

## 5. Verification

- [x] 5.1 back `npx vitest run`; `tsc -p tsconfig.build.json --noEmit` (**not** `nest build` while
      `start:dev` is watching — it wipes `dist/` and takes the API down). Expect the known
      date-dependent attendance-correction failure.
      → 1598 passed / 1 failed — the known date-dependent attendance-correction test, unrelated
      (it asserts against a malformed date, `2026-07-46`). `tsc -p tsconfig.build.json --noEmit`
      clean. A first run reported 61 failures and was **my own doing**: two full suites running
      concurrently against the same test database, both calling `dropSchema`/`refreshDatabase`.
      The tell was skips jumping from 36 to 261. Re-run alone, it is clean.
- [x] 5.2 front `npm run typecheck` (**not** bare `npx vue-tsc --noEmit`, which checks nothing in
      this repo) and `npx vitest run`.
      → 853 passed across 96 files, `vue-tsc -b` clean.
- [x] 5.3 `openspec validate --all`.
      → 72 passed / 0 failed.
- [x] 5.4 Open the seeded Office Supplies budget on the running app and check the arithmetic that
      started this: the ledger column must sum to **−185,000**, matching `815,000 − 1,000,000`,
      where it sums to −270,000 today. Look at a settlement row in both light and dark before
      calling 3.2 done — that one is a legibility judgement, not arithmetic.
      → The rendered column now sums to **−185,000**. In both themes a settlement reads
      `⇄ 35,000` in the muted token beside `↗ −35,000` in red: distinct from an outflow and from an
      empty cell.

## 6. What this change does not touch

- [x] 6.1 No balance, derived figure or stored value changes. `available` was already correct; only
      the ledger's presentation of it was not.
      → Held. The backend edit is a refactor with identical results.
- [x] 6.2 The waterfall, the breakdown and the budget-to-ledger reconciliation report already treat
      `ACTUAL` correctly and are left alone.
      → Untouched.
- [x] 6.3 Two of the reservations visible on that screen are known oddities from earlier work and
      are NOT in scope: `CLAIM-HAL-2026-0001` holds 50,000 that can never be released (recorded as
      known-bad demo data in `reserve-only-what-something-can-settle`), and `PROC-HAL-2026-0001`
      holds 50,000 legitimately in flight. Both are reservations, both are correctly shown as
      deductions, and neither is what this change is about.
      → Left as they are.
- [x] 6.4 Whether `RELEASE` should also read as part of a settlement rather than as new money
      arriving is noted as an open question in the design and deliberately not answered here.
      → Still an inflow; the question stays open in `design.md`.

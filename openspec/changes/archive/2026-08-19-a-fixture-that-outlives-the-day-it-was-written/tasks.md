# Tasks — A fixture that outlives the day it was written

## 1. The closed-period correction

- [x] 1.1 Add a helper beside `declareJuly` that declares a period **positioned relative to today**,
      covering a shift day that is both inside the correction window and inside the period. Its own
      helper, not an option on `declareJuly` — a helper named for July that sometimes covers August
      is read wrong later (D2).
- [x] 1.2 Derive the range in **days from today**, not from a month, so no calendar arithmetic is
      involved and the month/year boundary cannot bite (D-risk).
- [x] 1.3 `rejects a correction into a closed period, naming it` uses it: shift day and
      `requestedAt` both derived, so `ageDays` stays inside the default 30-day window and the
      **period** refusal is the one that fires.
- [x] 1.4 Leave `declareJuly` and its nine other callers on absolute July. Nothing measures those
      from today, and absolute is the default (D1).
- [x] 1.5 The `expect` stays byte-identical — still `rejects.toThrow(new RegExp(period.code))`
      (D4). A date fix that also moves the assertion is indistinguishable from papering over a real
      defect.

## 2. The delegation window

- [x] 2.1 `refuses the author's delegate too` builds its one-day window with
      `localDateIn(new Date(), 'Asia/Bangkok')` — the helper the eligibility check itself uses, and
      the one `delegation-company-day.spec.ts` exists to protect.
- [x] 2.2 Do **not** widen the window to two days. That would pass without being right and would
      erase the fact that a *one-day* delegation is the case under test (D3).
- [x] 2.3 The `expect` stays byte-identical — still `rejects.toThrow(/creator/i)` and still
      `entriesFor(v.id) === 0`.
- [x] 2.4 Checked: the module-level `TODAY` is used once, as `txnDate` on a `BudgetTxn` fixture
      row. The GL entry date comes from `payment.paidAt`, not from that row, so nothing measures it
      against now. **Left as it is**, which is the answer the task anticipated.

## 3. Tests

- [x] 3.1 Both specs pass. That is the deliverable — there are no new tests to write, because the
      subjects are unchanged and already covered.
- [x] 3.2 **Prove the correction fix does not decay**: run it with the system clock moved a year
      forward and confirm it still passes. Without this the fix is asserted, not demonstrated, and
      the whole point of the change is that "passes today" was never enough.
- [x] 3.3 **Prove the delegation fix at the hostile hour**: run it with the clock at an instant
      where the UTC day and the Bangkok day differ (e.g. 01:00 Bangkok = 18:00 UTC the day before)
      and confirm it passes. Confirm it FAILED there before the fix — otherwise the second defect
      was never demonstrated, only reasoned about.
- [x] 3.4 Mutation: revert each fixture to its old form and confirm the matching hostile-clock run
      goes red. Restore from a scratch copy, never `git checkout`.

## 4. Verification

- [x] 4.1 back `npx vitest run`, one suite at a time — the tell for a concurrent run is the skip
      count leaving 36. **Expect zero failures**: this change is what removes the last one.
- [x] 4.2 back `npx tsc --noEmit` adds no errors beyond HEAD's (compare the counts; the project
      carries a large pre-existing set, so only the delta means anything).
- [x] 4.3 `openspec validate --all`.
- [x] 4.4 No front-end run — nothing client-side is touched.

## 5. Scope deliberately left out

- [x] 5.1 **No production code changes.** The service ordering that produces the first failure is
      correct and documented; the helper the second needed already exists and is already tested
      across the midnight boundary in both directions.
- [x] 5.2 **The other thirteen clock-derived `TODAY` constants are not audited.** Fifteen specs
      derive a calendar day from the clock; the two read by a now-relative rule are fixed here. The
      rest have not failed — which is exactly what was true of these two until it wasn't.
- [x] 5.3 **No clock-faking harness in the DB-backed specs.** Pinning system time inside them would
      reach much further than two fixture defects justify, and `localDateIn` already has fake-clock
      coverage in `company-clock.spec.ts`.
- [x] 5.4 **Neither test's subject changes.** Only the dates each builds.
- [x] 5.5 **The leftover demo data is not touched** — `ISSUE-HAL-2026-0001`'s lost lines, the
      throwaway MEMO, and `XFER_NOWH`. Those are data decisions for the user, not this change.

## 6. Found while applying

- **The old correction test passed in isolation, for the wrong reason.** The assertion is
  `rejects.toThrow(new RegExp(period.code))`, and `declareJuly` builds codes shaped `2026-07-N`. A
  low sequence number gives `2026-07-1`, which **matches the shift date inside the window
  refusal's own message** — `"2026-07-15 is 35 days old…"`. So run alone the test was green while
  proving nothing at all; only the whole-file run, where the sequence had climbed past the
  collision, exposed it. The new code prefix `around-today-N` cannot appear in any other refusal,
  which makes the unchanged assertion mean what it says. That is load-bearing, not cosmetic, and is
  now commented where the code is chosen.
- **This nearly cost a false mutation result.** The first mutation attempt ran with `-t`, saw the
  reverted fixture pass, and would have concluded the fix was unnecessary. A mutation check has to
  run the same way the failure was observed.
- **A "third instance" turned out to be the harness.** At the hostile hour, `reverses an AUTOMATIC
  posting too` failed with `RangeError: Invalid time value`. It failed at harmless instants too, so
  it was the scratch clock: a `class FakeDate extends Date` changes `constructor` identity and
  MikroORM/pg hydrated dates as NaN. Rewritten as a Proxy so instances are real `Date`s — and
  guarded against re-install, because setupFiles are evaluated once per test file and the second
  evaluation captured the Proxy as "the real Date" and recursed forever. Reported here rather than
  as a finding, because it was not one.
- **The harness is not committed.** It lived as `src/__fake-clock.scratch.ts` plus a
  `vitest.fake.config.ts` for the duration of the checks and both are removed. Reproduce with a
  setup file that offsets `Date` and `FAKE_NOW_MS` set to the target instant.


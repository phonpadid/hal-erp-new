## Context

Three defects, all in test code, all producing the same damage: a result that says "broken"
when nothing is broken.

**1. A date that means something different every day.**
`leave-request.service.spec.ts` proves that a leave request filed with too little notice is
refused and reserves nothing. It builds the requested date as:

```
const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
```

The fixture employee has no `employee_shift` row, so `ShiftResolutionService` falls back to the
department's `defaultWorkShift` — the Office shift the file seeds with weekdays 1–5 full and
weekday 6 ending at 12:00, leaving Sunday the only day nobody works. On a Sunday the shift
resolves but the day is not a working day, `countLeaveDays` returns `0.00`, and
`LeaveRequestService.create` throws `This request covers no working days — there is nothing to
charge` before submit is ever reached. The test then fails on a `rejects.toThrow(/at least .* day/)`
that never had a chance to run.

```
   day the suite runs    "tomorrow" is      countLeaveDays   result
   ─────────────────────────────────────────────────────────────────
   Mon–Thu               a working day      1.00             passes
   Fri                   Saturday, a half   0.50             passes
   Sat                   Sunday             0.00             FAILS
   Sun                   Monday             1.00             passes
```

One day in seven — often enough to be met regularly, rare enough that each occurrence looks like
a fluke rather than a pattern.

The rest of the file already does this correctly: it pins named calendar dates
(`MON = '2026-03-02' … SUN = '2026-03-08'`) precisely so the weekday of each fixture is a stated
fact rather than an accident. Only this one test reaches for the wall clock.

**2. A mock narrower than the surface it stands in for.**
`views/budgets/waterfall.spec.ts` replaces `../../api/budgets` with a literal object carrying
`get`, `breakdown`, and `ledger`. `BudgetDetailView`'s `onMounted` also calls
`budgetsApi.movementDocTypes()`. The call is written defensively — `.catch(() => movementTypes.value)`
— but `.catch` never runs, because calling a property that is `undefined` throws `TypeError`
synchronously inside the async hook. The rejection escapes the test, Vitest counts it as an
unhandled error, and the process exits non-zero while reporting every test as passed.

**3. A teardown that removes the ground from under a live component.**
`VendorBankAccountsPanel.spec.ts` clears `document.body.innerHTML` in `beforeEach` to stop a
previous test's teleported PrimeVue dialog from lingering. The wrappers themselves are never
unmounted, so a component from the previous test is still mounted, still reactive, and still
holds references to DOM nodes that no longer have a parent. When it next patches, Vue calls
`insertBefore` on `null`.

## Goals / Non-Goals

**Goals:**
- `pnpm --filter back test` passes on every day of the week, including today (Saturday).
- `pnpm --filter front-end test` exits `0` when every test passes.
- The reason each test is stable is legible in the test itself, not folklore.
- Write down the rule in the specs so the next such test is caught in review.

**Non-Goals:**
- Changing any production code. All three defects are in specs; the services and views behave
  correctly, and the leave-request "no working days" guard is a feature the fix must keep intact.
- Adding a test gate to `.github/workflows/deploy.yml`. That is the natural next change, and it
  depends on this one, but bundling them would gate deploys on a suite whose repair is unproven.
- Auditing every other `Date.now()` in the suites. `attendance-capture.service.spec.ts` uses the
  clock legitimately (dedupe windows are relative to now, not to a calendar day) and is left alone.
- Un-skipping the seven `verify-dev-*.spec.ts` files. Their `DB_NAME === 'new_erp'` gate is
  deliberate — they verify against the dev database the team reads by hand.

## Decisions

**Derive the next working date; do not freeze the clock.**
The test needs a date that is (a) in the future and (b) a working day for the fixture's Office
shift. A small helper that walks forward from today until it lands on a Monday–Friday satisfies
both, keeps the test's intent readable, and stays comfortably inside the 3650-day advance-notice
window the test configures, so the notice rule still trips. Saturday is skipped as well even
though this fixture works it as a half day, so the test does not quietly depend on that detail
surviving a future edit to the fixture's `work_shift_day` rows.

*Alternative — `vi.setSystemTime` to pin a known Monday.* Rejected: this is a DB-backed spec
sharing an ORM and a live Postgres connection with the rest of the file. A frozen clock would
also freeze the `createdAt` stamps MikroORM writes and the `now` the service compares against,
which is a much larger blast radius than the one test needs.

*Alternative — a fixed far-future date such as `'2030-03-04'`.* Rejected: it is a working day
today and silently becomes a past date in 2030, which is the same bug with a longer fuse.

**Give the helper a name that states the invariant.** `nextWorkingDate()` — with a comment saying
why "tomorrow" is not good enough — so the next person who needs a future date copies the right
thing. It lives in the spec file next to the `MON…SUN` constants, because it is the same kind of
fact and nothing else needs it yet.

**Mock from the real module's shape.** The `vi.mock` factory already awaits the actual module.
Rather than adding `movementDocTypes` and waiting for the next drift, spread the real
`budgetsApi` and override only the members the test wants to control. A method added to the API
tomorrow then resolves to its real implementation rather than to `undefined`.

*Alternative — add `movementDocTypes: vi.fn()` and stop.* Rejected on its own; it fixes this
instance and leaves the class of bug in place. The test still asserts on the three overridden
members, so nothing is lost by spreading.

**Unmount instead of clearing the body.** Track the wrappers each test mounts and unmount them in
`afterEach`, which removes both the component and its teleported dialogs the way the framework
intends. `@vue/test-utils` ships `enableAutoUnmount(afterEach)` for exactly this. The
`document.body.innerHTML = ''` line then has nothing left to clean up and goes away with its
comment.

**No sequence note, transaction boundary, or lock applies.** Nothing in this change writes
`budget_txn` or `quota_usage`, or any other row. The `QuotaUsage` assertion in the repaired test
is a read that expects zero rows, and it keeps expecting zero rows.

## Risks / Trade-offs

**The repaired leave test could pass for the wrong reason** — if `nextWorkingDate()` returned a
date the fixture shift does not work, the test would fail the same way and look like a
regression → the fix is verified today, Saturday 2026-07-25, when the current test is red; a
green run today is direct evidence the weekend dependency is gone, and a run on a weekday
confirms nothing else broke.

**Spreading the real `budgetsApi` into the mock could let a real network call through** if the
view starts calling a member the test does not override → the members that drive this view's
render (`get`, `breakdown`, `ledger`) stay overridden, and any unoverridden call in jsdom fails
loudly rather than silently succeeding, which is the behavior we want from a drifting mock.

**Auto-unmount could expose an ordering assumption** in the vendor-panel tests that the leftover
DOM was accidentally satisfying → the file's assertions that read from `document` after opening a
dialog are the ones to watch; if any of them relied on a previous test's leftovers, that is a
real defect in the test and is better found now than during a deploy.

**The suites stay ungated after this change**, so nothing forces anyone to run them → accepted
deliberately; the follow-up change adds the gate, and this change is what makes that gate
survivable.

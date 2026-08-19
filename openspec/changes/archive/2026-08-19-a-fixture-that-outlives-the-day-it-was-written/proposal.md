# A fixture that outlives the day it was written

## Why

The backend suite has been red for weeks on a defect that does not exist.

```
attendance-period.service.spec.ts:562
  expected  /2026-07/                                    (the period's code)
  received  "2026-07-15 is 35 days old; this company allows
             corrections up to 30 days back"
```

The test raises a correction into a **closed period** and asserts the refusal names the period. It
gets a different refusal: the rolling 30-day correction window, which the same service checks
first. Both refusals are correct. The ordering is deliberate and documented in the service —
*"After the rolling window, so the more specific message wins"* — and the assertion was true when
it was written, because 2026-07-15 was then inside thirty days of the run. It has not been since
mid-August, and it will never be again.

**A test that decays is worse than a test that fails.** `platform-foundation` already says so:

> A spec SHALL produce the same result on every calendar day, so that a red suite always means a
> real defect.

That requirement exists and this spec is outside it, exactly as the last change found two endpoints
outside "every request DTO SHALL be validated". The cost is the same and it is already being paid:
every run since has needed a human to remember that one particular red line is not a defect, which
is the habit that hides the next real one.

**A second instance is green only by the hour it runs.**

```ts
// journal-voucher.spec.ts — "refuses the author's delegate too"
const today = new Date().toISOString().slice(0, 10);   // the server's UTC day
… startDate: today, endDate: today                     // a one-day delegation window
```

Eligibility is evaluated on the **company's** local day. The seeded company is UTC+7, so between
00:00 and 07:00 in Bangkok the UTC day is still yesterday, the one-day window does not cover today,
the delegation is not active, and the test fails. It passes for seventeen hours out of twenty-four.

The sharp part: `delegation-company-day.spec.ts` exists precisely because this was a **production**
bug, and its docblock says so — *"It used to be `new Date().toISOString()` — the server's UTC day,
wherever the box happens to be."* The production code was fixed. A fixture two directories away
still writes the bug the fix was written against, and there is a tested helper, `localDateIn`, that
has been sitting there the whole time.

**Both are the same mistake in two shapes:** a fixture stating a date that some rule then measures
against *now*. One states it absolutely and drifts out of range; the other derives it from the
wrong clock and drifts out of range twice a day.

## What Changes

**The closed-period correction test derives its dates from today.** The period it closes and the
shift day it corrects are positioned so the day is always inside the correction window and always
inside a closed period — which is the situation the test is about. The absolute July dates stay
wherever the assertion is about July and nothing measures from now.

**The delegation window is built from the company's day, not the server's.** Using `localDateIn`,
the helper the production code already uses and that is already tested across the midnight
boundary in both directions.

**Neither test's subject changes.** Each asserts exactly what it asserted before; only the dates it
builds do.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `platform-foundation`: the date-independence requirement gains the second shape — a fixture
  reading the wrong clock — alongside the weekday case it already names.

## Impact

- `back/src/modules/attendance/attendance-period.service.spec.ts` — the correction fixture.
- `back/src/modules/gl/journal-voucher.spec.ts` — the delegation window.
- No production code changes. No schema, no migration, no client.

## Who this answers

| party | today | after |
| --- | --- | --- |
| whoever runs the backend suite | one red line to remember is not a defect | green means green |
| whoever runs it before 07:00 in Bangkok | a second, different red line | green there too |
| whoever adds a spec near a now-relative rule | no example of how to date a fixture | two, and the helper named |
| whoever reads `platform-foundation` | "the same result on every calendar day", with two exceptions | true as written |

## What This Change Does NOT Do

- **Does not audit the other thirteen `TODAY` constants.** Fifteen specs derive a calendar day from
  the clock; two are proven wrong and are fixed here. The rest stamp a date rather than compare
  against a now-relative rule, and have not been examined one by one. This is the honest limit of
  the change and the reason the requirement is worth strengthening rather than assuming the sweep
  is complete.
- **Does not touch production code.** Both defects are in fixtures. The service ordering that
  produces the first is correct and stays; the helper the second should have used already exists
  and is already tested.
- **Does not change what either test asserts.** If a test's subject needed changing, that would be
  a different change and a real defect would be hiding behind it.
- **Does not add a clock-faking harness.** Pinning the system time inside DB-backed specs would
  reach further than these two defects justify, and `localDateIn` is already covered under a fake
  clock in `company-clock.spec.ts`.
- **Does not fix the seeded demo data** left over from earlier work.

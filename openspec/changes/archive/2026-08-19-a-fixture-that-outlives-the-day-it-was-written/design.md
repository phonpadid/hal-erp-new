# Design — A fixture that outlives the day it was written

## Context

Two fixtures state a date that a rule then measures against *now*:

```
attendance-period.service.spec.ts   shift day 2026-07-15, absolute
                                    read by a rolling 30-day window → drifts out, permanently

journal-voucher.spec.ts             window [today, today], from the UTC day
                                    read on the company's local day → drifts out, 00:00–07:00 daily
```

One is red now and stays red. The other is green for seventeen hours a day. Both are fixture
defects; the production code either is correct (the first) or was already fixed for exactly this
(the second).

## Goals / Non-Goals

**Goals:**

- Both specs produce the same result on every calendar day and at every hour.
- Each still asserts precisely what it asserted before.

**Non-Goals:**

- No production change. The service ordering that produces the first failure is right; the helper
  the second should use already exists.
- No audit of the other thirteen clock-derived `TODAY` constants.
- No clock-faking harness inside DB-backed specs.
- No change to what either test is about.

## Decisions

### D1. Absolute dates by default; relative only where a rule measures from now

The tempting fix is to make every date in the suite relative. That is worse: a relative date is
harder to read, invites its own boundary bugs (month ends, year ends, leap days), and would churn
sixty-two files to fix two.

The rule that actually distinguishes them is narrower and is what these two violate:

> A fixture's date is stated absolutely, **unless some rule under test measures it against now** —
> then it must be derived from now, so the distance the rule measures is fixed.

`2026-07-15` is a fine date for a test about July. It stopped being fine the moment a
thirty-day-from-today window read it. So only the one test whose subject is a now-relative rule
moves; `declareJuly` and its nine other callers keep their absolute July, because nothing measures
those from today.

### D2. The correction test declares a period around today, and corrects a day inside it

The situation the test is about is *a shift day that is inside the correction window and inside a
closed period* — the case the service's ordering comment describes. Both halves have to hold, so
the period is positioned relative to today rather than the day being positioned relative to a fixed
period.

Checked, not assumed: `declare` refuses only a reversed range and an overlap, and `close` refuses
only an already-closed period. Neither requires the period to be in the past, so a period covering
today can be declared and closed. The correction's `ageDays` is then small and the window
(defaulting to 30) is satisfied, leaving the period refusal to fire — which is the one the
assertion is about.

The period gets its own helper rather than an option on `declareJuly`, because a helper named for
July that sometimes covers August is the kind of thing that gets read wrong later.

### D3. The delegation window is built with `localDateIn`, the helper production already uses

Not by hand-rolling a timezone offset, and not by widening the window to two days to paper over the
boundary. Widening would make the test pass without making it right, and would erase the fact that
a **one-day** delegation is the case being tested.

`localDateIn(new Date(), 'Asia/Bangkok')` is what `delegation-company-day.spec.ts` was written to
protect and what the eligibility check itself reads. The company entity defaults `timezone` to
`Asia/Bangkok`, so the fixture and the rule agree by construction rather than by coincidence.

### D4. Neither assertion changes

Whatever a fixture fix touches, the `expect` stays byte-identical. A date fix that also adjusts
what is asserted is indistinguishable from a real defect being papered over, and this change exists
because that distinction had already been lost once — a red line everyone had learned to ignore.

### D5. The requirement gains the second shape, not a second requirement

`platform-foundation` already forbids a spec whose result depends on the day it runs, and names the
weekday case. The clock-source case — a fixture reading the server's UTC day where the rule reads
the company's — is the same requirement, so it becomes another scenario under it rather than a new
one competing for the same ground.

## Risks / Trade-offs

- **A relative fixture can develop its own boundary bug.** A period built around today crosses a
  month end once a month and a year end once a year. Mitigated by deriving the range in days from
  today rather than from a month, so no calendar arithmetic is involved — but it is the hazard this
  approach trades for, and it is the reason D1 keeps it to one test.
- **Thirteen clock-derived constants remain unaudited.** They stamp dates rather than being read by
  a now-relative rule, which is why they have not failed — but "has not failed yet" is what was true
  of both of these. The change is honest about not having looked rather than implying a clean sweep.
- **The suite still cannot prove itself date-independent.** Nothing here runs it at a hostile hour.
  The two known instances are fixed and the requirement is sharper; a spec that could not be written
  wrong is out of reach without a clock harness, which costs more than these two defects justify.
- **This fixes tests, not the product.** Worth saying plainly: no user is affected. The value is
  that a red suite means something again.

## Migration Plan

None. Test-only. Rollback is reverting the commit.

## Open Questions

- **Whether the remaining `TODAY` constants should be swept.** Fifteen exist; the two read by a
  now-relative rule are fixed. Deciding the rest needs someone to ask, per site, whether anything
  measures that date against now — cheap per site, but thirteen of them, and not this change.

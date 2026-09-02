## Context

This slice joins the two halves already built. `attendance-shift` answers "what was expected of
this person on this date"; `attendance-capture` answers "what did they actually do". Neither can
say "late" alone.

The shape to copy is already in the codebase. `stock_balance` stands to `stock_txn` exactly as
`attendance_day` stands to `attendance_event`: an append-only ledger of facts, and a derived row
that exists so nobody has to aggregate the ledger on every read. Invariant 3's rule applies
unchanged — replaying the ledger must reproduce the projection exactly, and the projection is
never a number somebody writes directly.

One thing makes attendance harder than stock. `stock_balance` derives from the ledger alone.
`attendance_day` derives from the ledger *plus* configuration that can change afterwards: the
shift, the holiday calendar, and (from slice 4) approved leave. That is why the previous slice
committed in writing to snapshotting the shift onto each daily row, and why this slice has to be
careful about which of its inputs are frozen and which are re-read.

## Goals / Non-Goals

**Goals:**

- Produce, per employee per shift day, the comparison between expectation and observation: due
  time, arrival, worked minutes net of break, lateness, early departure, and overtime by kind.
- Make a night shift work. A 22:00–06:00 shift spans two calendar dates and must be one row.
- Keep the projection rebuildable: same ledger and same snapshot must always yield the same row.
- Split overtime into the three kinds Thai law prices differently, at computation time, because a
  total cannot be unsplit later.
- Count lateness in both minutes and occurrences, because pay and discipline ask different
  questions of the same event.
- Leave a clean seam where leave (slice 4) and certified overtime (slice 5) attach, without
  either needing to reshape this table.

**Non-Goals:**

- No leave. `LEAVE` is not a reachable status yet; a working day with no punches is `ABSENT` and
  slice 4's recompute reclassifies it.
- No approved overtime, no quota, no entitlement. The minutes here are raw observations.
- No period close, no payroll export, no locking. Rows recompute freely.
- No pay rates or money of any kind.
- No scheduled/background recomputation. Recompute is invoked, not timed.
- No frontend.

## Decisions

### 1. Punches are collected by the shift's window, not by `local_date`

This is the decision the whole slice turns on.

```
Day shift 08:00-17:00, shift day D
  window = D 08:00 - grace/early allowance ... D 17:00 + overtime allowance
  every punch inside it belongs to D          (local_date is also D — no difference)

Night shift 22:00-06:00, shift day D          (end_minute 1800, i.e. 06:00 on D+1)
  window = D 22:00 ... D+1 06:00 (+ allowances)
  IN  at D   22:05  -> local_date D
  OUT at D+1 05:58  -> local_date D+1
  BOTH belong to shift day D
```

Grouping by `local_date` — the obvious reading of "a day's punches" — splits a night shift into
two halves and marks both `INCOMPLETE`. Since `work_shift` already permits `end_minute > 1440`,
that failure is reachable with data the previous slice accepts, so it has to be handled here
rather than deferred.

The window is widened past the shift on both sides so an early arrival and an overtime departure
are still captured: `[expected_in − EARLY_ARRIVAL_WINDOW, expected_out + LATE_DEPARTURE_WINDOW]`,
both a few hours. Deliberately not unbounded — a punch twelve hours after the shift ended belongs
to the next shift day, not this one, and an open-ended window would steal it.

Consequence to be honest about: **consecutive night shifts can contest a punch**. If D's window
runs to 06:00+3h and D+1's begins at 22:00−3h, they do not overlap for a 22:00–06:00 shift, so the
current shape is safe. A shift longer than about 18 hours would break that, which is why the
allowances are constants with a comment rather than a configurable knob to be widened casually.

### 2. The row snapshots the shift; it re-reads everything else

`shift_code`, `expected_in_minute`, `expected_out_minute` and `expected_minutes` are copied onto
the row at computation. The comparison is made against the copy.

That is the contract `attendance-shift` recorded, and the reason is concrete: HR moving the office
start from 08:00 to 08:30 in July must not, on the next recompute, un-late everyone who arrived at
08:15 in June.

Holidays and (later) leave are deliberately **not** snapshotted. A holiday added retroactively —
a government-declared substitute day — *should* reclassify the past, because the day genuinely was
a holiday and the earlier `ABSENT` was wrong. The distinction is whether the configuration change
corrects a misstatement about the past (holiday: re-read) or expresses a decision about the future
(shift hours: snapshot).

This asymmetry is the real content of the decision, and it is why period close eventually matters:
once a month has been exported for pay, even a correct reclassification must stop moving it. The
row carries `computed_at` so that a future close can record what was frozen and when.

### 3. Status says what the day was; minutes say what happened in it

```
resolve(employee, shift day D):

  no shift resolves for D              -> NO_SHIFT     (a valid state, not an error)
  D is in holiday_calendar             -> HOLIDAY
  D's weekday is non-working           -> DAY_OFF
  employee.attendance_required = false -> EXEMPT
  no punches in the window             -> ABSENT
  punches, but no usable in/out pair   -> INCOMPLETE
  otherwise                            -> PRESENT
```

A combinatorial status (`LATE`, `LATE_AND_EARLY`, `HOLIDAY_WORKED`, …) was rejected. Lateness and
early departure are quantities, not categories: a `PRESENT` row with `late_minutes = 12` says
strictly more than a `LATE` row, and the enum stops multiplying every time a new dimension appears.
The same applies to working a holiday — the status stays `HOLIDAY` and `holiday_work_minutes` is
non-zero, so "who worked on a holiday" is a filter rather than another status.

`HOLIDAY` outranks `DAY_OFF` because it is the more specific reason a Sunday public holiday was
not a working day. `EXEMPT` sits after both so an executive's holiday still reads as a holiday.

`LEAVE` is missing on purpose and slots between `EXEMPT` and `ABSENT` when slice 4 lands. Fixing
its position now means that slice adds a branch rather than reordering the ladder.

### 4. Worked minutes: first in, last out, minus the break overlap

```
worked = (last_out − first_in) − overlap(worked interval, break window)
```

First/Last rather than pairing, as settled earlier: the middle punches are recorded but not
interpreted, so a mis-pressed button cannot corrupt the day. Because the ledger keeps every punch,
switching to a pairing model later is a change to this function alone, with no data loss — which
is what made First/Last safe to choose.

The break is deducted by *overlap*, not as a flat number, exactly as `attendance-shift` specified:
someone who works 13:00–17:00 never sat through a 12:00–13:00 lunch and must not be charged for it.

### 5. Overtime is split into three kinds at computation

```
                     within shift hours        beyond shift hours
  working day        (ordinary pay)            ot_normal_minutes
  holiday / day off  holiday_work_minutes      ot_holiday_minutes
```

Thai labour law prices these at different multiples, and monthly-paid and daily-paid staff differ
again on holiday work — which is why `employee.employment_type` was added in slice 1. A single
`ot_minutes` total cannot be separated afterwards, so the split happens where the information
still exists.

**Multipliers are not stored anywhere in this system.** The export carries hours by kind; whatever
prices them applies the rates. The platform is multi-company across Thailand and Laos, whose rates
differ, so embedding one country's numbers would be exactly the hardcoding invariant 7 forbids.

Overtime below `ot_min_minutes` is discarded and the remainder is rounded **down** to
`ot_round_minutes` blocks — both read from the shift, both established in the earlier design
discussion, and rounding down because rounding up pays for time nobody worked.

### 6. Recomputation is invoked, never scheduled, and capture does not trigger it

Three entry points: one employee-day, one employee over a date range, and a whole company for one
date. All are idempotent — recomputing an unchanged day rewrites the same numbers.

Capture deliberately does **not** call recompute on insert. Two reasons: a punch endpoint on a
phone should not carry the cost of a projection write, and coupling them would mean a failure in
the projection could reject a punch — losing a fact to protect an opinion, which is backwards.

The cost is that rows are stale until recomputed, and this slice does not hide that: every row
carries `computed_at`, and the read endpoint reports it, so a caller can see the projection's age
rather than assume freshness. A scheduled sweep is the obvious next step and is left out
deliberately rather than half-built.

### 7. Uniqueness, and why the write is an upsert under a lock

`(company_id, employee_id, shift_date)` is unique — one row per person per shift day, which is
what makes the projection a projection.

Recompute reads the existing row, replaces its numbers, and writes. Two concurrent recomputes of
the same day (an admin's manual run racing a range rebuild) would otherwise both insert and hit
the unique constraint, or interleave and write a half-updated row. The daily row is therefore read
under `LockMode.PESSIMISTIC_WRITE` inside the recompute transaction — the same pattern the two
previous slices needed, and for the third time the reason is that a read-then-write at READ
COMMITTED is not safe on its own.

### 8. The computation itself is a pure function

`computeDay(punches, snapshot, holiday, employeeFlags) -> numbers` takes no `EntityManager`, does
no I/O, and returns a plain object. The service loads inputs, calls it, and persists the result.

This is worth stating because it is what makes the rules testable at all. Every rule in this slice
is arithmetic on times, and the interesting cases — a night shift crossing midnight, a half-day
Saturday, a break partially overlapped, overtime one minute below the floor — are all expressible
as a fixture and an expected object, with no database. The DB-backed tests then only need to prove
that loading and persisting work, not that the arithmetic does.

### 9. Transactions and locking

**This slice writes no `budget_txn` and no `quota_usage` rows, and issues no document numbers.**
There is no reserve/actual/release sequence to order.

The one boundary is decision 7: each employee-day's recompute takes its projection row
`FOR UPDATE` and writes inside one `em.transactional(...)`. A range or company-wide recompute is
*not* one giant transaction — it commits per employee-day, so a failure on one person's Tuesday
does not roll back a month of correct rows for everyone else. Idempotency is what makes that safe:
a partial run is simply re-run.

## Risks / Trade-offs

- **The shift-window allowances are constants, and a pathological shift could make two days
  contest a punch** → Safe for any shift up to ~18 hours, which covers every real roster. Stated
  in decision 1 with the arithmetic so the limit is visible rather than discovered.

- **Rows go stale between recomputes** → Accepted and surfaced: `computed_at` is on the row and in
  the read. The alternative — recomputing on every punch — puts a projection write in the path of
  a mobile check-in and lets a projection bug reject a fact. A scheduled sweep is the intended fix
  and is deliberately not half-built here.

- **A retroactive holiday rewrites past days** → Intended (decision 2): the day genuinely was a
  holiday and the previous `ABSENT` was wrong. It becomes a problem only once figures have been
  exported for pay, which is the argument for period close and is why `computed_at` exists now.

- **`ABSENT` will be wrong for anyone on approved leave until slice 4** → Unavoidable in a sliced
  build and called out in the proposal. Recomputation reclassifies with no migration, because the
  projection is derived. The risk is operational, not structural: do not report absence to anyone
  as authoritative before leave lands.

- **First/Last cannot see time spent away mid-day** → The deliberate trade from the earlier design
  discussion. The ledger keeps every punch, so switching to pairing later is a change to one pure
  function with no data loss.

- **Three overtime columns look like over-modelling for a company that may only ever use one** →
  They are cheap now and impossible to reconstruct later. A single total, once written, cannot be
  told apart into the kinds that pay 1.5×, 2× and 3×.

## Migration Plan

1. **Forward migration**, additive only: create `attendance_day` with the unique index on
   `(company_id, employee_id, shift_date)`, an index on `(company_id, shift_date)` for the
   day-wide board, foreign keys to `company` and `employee`, and a check constraint on `status`.
2. **Update `erp_approval_system.dbml`** in the same change, including the status enum.
3. No backfill. The table is derived: it is populated by running recomputation over whatever range
   is wanted, which is also the first real exercise of the code.

**Rollback:** a plain `drop table`. Nothing references it, and the ledger it derives from is
untouched, so the projection can be dropped and rebuilt at any time — which is the property that
makes a projection a projection.

## Open Questions

- Should a scheduled sweep recompute yesterday for every company each morning? Almost certainly
  yes, but it needs a job runner this codebase does not yet have, and inventing one inside an
  attendance slice would be the wrong place for that decision.
- Should `INCOMPLETE` (a check-in with no check-out) count as worked time at all? This slice
  records zero worked minutes and leaves the punch visible, which is honest but pays nobody for a
  day they may well have worked. The correction request in slice 6 is the intended remedy; if that
  proves too slow in practice, a "treat as worked until shift end" policy flag on `work_shift`
  would be the configurable answer.
- Whether `EXEMPT` should suppress the row entirely rather than store one. Storing it keeps the
  projection complete and makes "who is exempt" answerable from one table, at the cost of rows
  nobody reads.

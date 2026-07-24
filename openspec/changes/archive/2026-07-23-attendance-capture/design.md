## Context

`attendance-shift` shipped the expectation; this slice ships the fact. Between them sits the
distinction the whole module rests on: a punch is an observation of the world, while lateness is
an opinion about it. Observations must be recorded faithfully and never revised; opinions get
recomputed whenever the rules or the configuration change. Keeping them in different tables — and
different slices — is what lets the daily projection be rebuilt at will without ever putting a
person's actual arrival time at risk.

That makes `attendance_event` the fourth ledger of a shape this codebase already knows.
`budget_txn`, `approval_log`, `journal_entry`/`journal_line` and `stock_txn` are all append-only,
guarded by `LedgerGuardSubscriber`, and corrected by writing new rows. Attendance joins them
rather than inventing a pattern.

It differs from them in one respect that shapes several decisions below: it is the first table in
the system whose row count is driven by headcount and time rather than by documents. A hundred
employees punching four times a day is roughly 150,000 rows a year — small in absolute terms, but
it means the access path has to be designed now, because the daily slice will hit it constantly.

## Goals / Non-Goals

**Goals:**

- Record a punch faithfully, including the parts the system cannot yet interpret, and make it
  impossible to alter one afterwards.
- Fix each punch to the calendar day it belonged to at the moment it happened, in the company's
  own timezone, so a later timezone correction cannot silently move history.
- Give the geofence policy declared in the previous slice its behaviour, and record the measured
  distance whether or not it passed.
- Let employees with no login account be recorded by someone who does have one, with the actor
  captured, so the exception is auditable rather than invisible.
- Make "every punch for this employee on this local date" a cheap indexed query.

**Non-Goals:**

- No `attendance_day`, no lateness, no absence, no worked minutes, no overtime. Nothing in this
  slice reads a shift.
- No correction *workflow*. `corrects_event_id` exists so slice 6's approved request has
  somewhere to write; this slice exposes no approval path to it.
- No offline queue or client-side buffering. A punch reaches the server or it does not.
- No device management, no biometric integration, no fake-GPS detection.
- No frontend.

## Decisions

### 1. `local_date` is stamped at capture, not derived at read

Each row stores both `occurred_at` (a `timestamptz`, the instant) and `local_date` (a `date`, the
company-local calendar day that instant fell on).

Deriving `local_date` at read time would be less redundant and is wrong. `company.timezone` is
editable master data. If an admin corrects a company's zone from `Asia/Bangkok` to
`Asia/Vientiane` — or a future company is set up wrong and fixed a month later — every historical
punch near a midnight boundary would silently change which day it belonged to, and with it every
lateness and absence figure already reported. Stamping the day at capture is the same reasoning
that locks `document.exchange_rate` at submit: the interpretation in force when the event happened
is part of the event.

The instant is kept alongside it because the day alone cannot answer "how late", and because a
stamped day that turns out to be wrong can be diagnosed only by re-deriving it from the instant.

### 2. Direction is explicit, and capture does not try to be clever about it

The client says `IN` or `OUT`; the server records what it was told. No inference from parity, no
rejection of an `IN` that follows an `IN`, no attempt to pair.

This looks lax and is deliberate. The First/Last model chosen for the daily projection uses only
the earliest and latest punch of a day, so a mis-pressed button in the middle changes nothing —
and a capture layer that rejected "impossible" sequences would be making a judgement, which is
precisely what this slice is not for. Someone who genuinely forgot to check out has a real
attendance problem; refusing their next check-in does not solve it and destroys the evidence.

The one thing capture does reject is a duplicate: the same employee, same direction, within
`DEDUPE_WINDOW_SECONDS` (60). That is not a judgement about their day, it is a defence against a
double-tap and a retried request, and 60 seconds is far below any interval a human would
deliberately produce.

### 3. Geofence: measure against every active location, judge by the nearest

```
punch arrives with (lat, lng)
        │
        ├─ no coordinates?        ─▶ geofence_status = UNKNOWN, accepted
        │
        ├─ no active locations?   ─▶ geofence_status = UNKNOWN, accepted
        │
        └─ measure distance to every active work_location
                │
                └─ take the NEAREST → record it, its distance, and:
                        inside radius            ─▶ INSIDE, accepted
                        outside, SOFT_WARNING    ─▶ OUTSIDE, accepted + flagged
                        outside, HARD_STOP       ─▶ refused (400)
```

Judging by the nearest rather than by a client-nominated site keeps the client honest — it cannot
pick the lenient office — and matches how people actually work: you are at a site or you are not,
and which one is a fact about your coordinates.

`UNKNOWN` is a first-class outcome, not a failure. A phone indoors may never get a fix, and a
company that has configured no locations at all has expressed no opinion about where work happens.
Refusing a punch in either case would punish someone for their building, so the row is stored with
the status recorded and the supervisor can see the difference between "outside the fence" and "we
do not know".

Distances use the haversine formula on a spherical earth. At the scale of a geofence radius the
error against a proper ellipsoidal model is well under a metre — far inside the GPS error the
policy exists to tolerate — and it avoids a dependency. The computation converts the stored
decimal strings to numbers only inside the distance function; what persists stays a decimal string.

### 4. On-behalf-of capture is a different endpoint, not a parameter

Self-service (`/check-in`, `/check-out`) takes no employee and no timestamp: the employee comes
from the caller's own account, the instant from the server clock. Recording for someone else
(`POST /attendance/events`) requires `ATTEND_PUNCH_MANAGE`, takes both, and always stamps
`source = MANUAL` with `recorded_by` set to the actor.

Splitting them means the self-service path has no code path that could ever accept an employee id
or a caller-supplied time, so no bug in validation can turn it into an impersonation route. It
also makes the audit question trivial: every manually-entered punch is exactly the set of rows
with a non-null `recorded_by`.

Backdating is permitted on the manual path without a window limit in this slice. A limit belongs
with period close, which does not exist yet; imposing an arbitrary one now would be a rule nobody
asked for that later has to be reconciled with the real one.

### 5. Exempt employees may still punch

`employee.attendance_required = false` excludes someone from absence reporting. It does not stop
their punches being stored, exactly as the previous slice's spec says. An executive who taps
check-in at a site visit produces a real observation; discarding it would be losing data to
enforce a reporting preference. Filtering happens where the reporting happens, in a later slice.

Resigned and terminated employees are a different case and are refused: recording attendance for
someone who has left is far more likely to be a mistake or a fabrication than a fact.

### 6. Indexing for the query the next slice will actually run

`(company_id, employee_id, local_date)` is the covering index, because the daily projection's
question is always "every punch for this person on this day". A second index on
`(company_id, local_date)` serves the supervisor's board — "everyone today" — which is the other
query that will exist within one slice.

Deliberately not indexed: `occurred_at`. Nothing asks a question in instant-space; every real
query is scoped to a company and a local day first.

### 7. Transactions and locking

**This slice writes no `budget_txn` and no `quota_usage` rows, and issues no document numbers.**
There is no reserve/actual/release sequence and no over-commit to guard.

A single punch is one insert and needs no transaction beyond the implicit one. Two places do need
a boundary:

- **The dedupe check** reads recent punches and then inserts, so it takes the employee row under
  `LockMode.PESSIMISTIC_WRITE` inside one `em.transactional(...)` — the same correction the
  previous slice's assignment overlap needed, for the same reason. At READ COMMITTED the read
  alone would let two retried requests both find nothing and both insert. This is the realistic
  race here: mobile clients retry, and a double-tap is a genuine duplicate the check exists to
  stop.
- **Bulk roll call** wraps all its inserts in one transaction, so a crew is recorded completely or
  not at all rather than half-checked-in.

### 8. What "append-only" is enforced by

`AttendanceEvent` is added to `LedgerGuardSubscriber`'s `APPEND_ONLY` list, so any UPDATE or
DELETE scheduled through the Unit of Work throws. This is the same mechanism protecting
`budget_txn`, `approval_log`, the GL journal, and `stock_txn` — attendance does not get its own.

The entity therefore exposes no setters worth using and the service never loads a row to modify
it. Correcting a punch means inserting a new row whose `corrects_event_id` names the old one; the
old row stays readable forever, which is the property that makes a manual entry auditable at all.

## Risks / Trade-offs

- **A stamped `local_date` can be wrong if a company's timezone was misconfigured when the punch
  was taken** → Accepted, and preferable to the alternative: the error is then visible and
  correctable by writing corrective rows, rather than invisibly rewriting months of history the
  next time anyone edits the zone. `occurred_at` is retained precisely so a bad stamp can be
  detected and recomputed.

- **Judging the geofence by the nearest location misattributes a punch taken between two nearby
  sites** → Real but benign: both are the company's own sites, the distance is recorded either
  way, and the policy applied is the nearer site's. A client-nominated site would trade this small
  ambiguity for the ability to choose the most permissive fence.

- **`UNKNOWN` is a hole an employee could exploit by denying location permission** → True, and
  accepted for the same reason `SOFT_WARNING` is the default: a geofence is an audit aid, not an
  access control, and fake-GPS defeats a stricter rule anyway. What the system guarantees is that
  the absence of a fix is *recorded* as such, so a pattern of it is visible.

- **No backdating limit on the manual path** → A holder of `ATTEND_PUNCH_MANAGE` can enter a punch
  for any past date. The mitigation is that they cannot do it invisibly: `recorded_by`, the entry
  time, and the target date are all on an unalterable row. The real limit arrives with period
  close.

- **Table growth is unlike anything else in this schema** → ~150k rows per hundred employees per
  year. Small now; the indexes in decision 6 are chosen for the queries that will exist, and
  partitioning by `local_date` is the obvious escape hatch if it is ever needed. Noted rather than
  pre-built.

## Migration Plan

1. **Forward migration**, one file, purely additive: create `attendance_event` with its foreign
   keys, its two indexes, and check constraints for `direction`, `source`, and `geofence_status`.
2. **Update `erp_approval_system.dbml`** in the same change.
3. No backfill — the table starts empty, and nothing existing reads it.

**Rollback:** a plain `drop table`. Because nothing else references it and no existing column
changed, a partial deploy leaves the system exactly as it is today.

## Open Questions

- Should `/check-in` reject a second check-in when one already exists for the local date, rather
  than only inside the 60-second dedupe window? Decision 2 says no — First/Last makes it
  harmless, and refusing it would be a judgement. Worth revisiting if real usage shows people
  punching repeatedly by accident.
- Should bulk roll call accept per-employee times, or only one shared instant? This slice takes
  one shared instant, which is what "check the crew in at 08:00" means. Per-employee times would
  make it a batch import, which is a different feature.
- `source = DEVICE` and `IMPORT` are defined in the enum but nothing produces them yet; the
  biometric/file path is a later slice. They are declared now so the column's domain does not have
  to change when it arrives.

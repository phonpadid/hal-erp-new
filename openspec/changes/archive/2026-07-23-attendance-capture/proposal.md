## Why

`attendance-shift` established what a company expects of an employee — which shift they work,
on which weekdays, with what tolerance for lateness — but nothing records what actually
happened. There is no way for anyone to say "I am here", and therefore nothing for the daily
slice to judge.

This slice adds that record and only that: the raw punch. It computes no lateness, marks nobody
absent, and produces no daily summary. Keeping capture separate from judgement is the point —
the punch is a fact about the world that must be recorded faithfully whether or not the system
can yet interpret it, and interpretation rules will change while the facts must not.

## What Changes

- **New `attendance_event` append-only ledger.** One row per punch: when it happened
  (`occurred_at` as an instant), which calendar day it belonged to in the company's own
  timezone (`local_date`), the direction (`IN` / `OUT`), where it came from (`source`), and —
  when the client offered coordinates — the location it was measured against, the distance in
  metres, and whether that fell inside the geofence. Registered with the existing
  `LedgerGuardSubscriber`, so an UPDATE or DELETE of a punch throws (invariant 2). A correction
  is a new row pointing at the one it supersedes via `corrects_event_id`, never a rewrite.
- **Self-service capture.** `POST /attendance/check-in` and `/check-out` resolve the caller's own
  `employee` from their user account and the active company, stamp the instant server-side, and
  accept optional coordinates. A caller cannot punch for anyone but themselves, and cannot choose
  the time.
- **Geofence evaluation at capture.** Coordinates are measured against the company's active
  `work_location` rows; the nearest one supplies the `control_policy` written in the previous
  slice. `HARD_STOP` refuses the punch; `SOFT_WARNING` accepts it and records the measured
  distance for a supervisor to see. A punch with no coordinates is accepted and marked as such —
  a missing GPS fix is not evidence of anything.
- **Recording on someone's behalf.** `POST /attendance/events` lets a holder of
  `ATTEND_PUNCH_MANAGE` record a punch for another employee at a stated time, including in the
  past, stamped `source = MANUAL` with `recorded_by` set to the actor. This is how employees with
  no login account get attendance at all, and it is auditable precisely because the ledger cannot
  be edited afterwards.
- **Bulk roll call.** `POST /attendance/events/bulk` records the same punch for many employees at
  once, so a supervisor can check in a crew without one request per person.
- **Reads.** A paged, company-scoped list filtered by employee, date range, source, and geofence
  outcome — plus a self-service "my punches today" read so the mobile client can show whether it
  already registered a check-in.
- **New permission codes** `ATTEND_PUNCH_SELF` (punch as yourself), `ATTEND_PUNCH_MANAGE` (punch
  for others, including backdated), and `ATTEND_PUNCH_READ` (read others' punches).
- **`erp_approval_system.dbml` updated** with the new table.

Deliberately not in this slice: `attendance_day`, lateness, absence, overtime minutes, leave, and
the correction *request* document (an approved workflow that writes a corrective punch is slice
6; the raw corrective row exists here so slice 6 has somewhere to write).

## Capabilities

### New Capabilities
- `attendance-capture`: the append-only `attendance_event` ledger, self-service and
  on-behalf-of punch endpoints, geofence evaluation against the configured `work_location`
  policy, bulk roll call, company-scoped reads, and the `ATTEND_PUNCH_SELF` /
  `ATTEND_PUNCH_MANAGE` / `ATTEND_PUNCH_READ` permission codes.

### Modified Capabilities
- `attendance-shift`: the work-location requirement currently states that the policy is declared
  but unenforced. That sentence stops being true here — `HARD_STOP` and `SOFT_WARNING` acquire
  the behaviour they were defined to describe.

## Impact

**Schema** — one new table, `attendance_event`. No existing column changes and no backfill; the
table starts empty. One forward migration.

**Backend** — the existing `attendance` module gains capture entities, a capture service, a
geofence evaluator, a controller, and DTOs. `LedgerGuardSubscriber` gains one entry.
`ShiftResolutionService` is untouched but is what a later slice will pair these rows with.

**Frontend** — none in this slice.

**Invariants** — `attendance_event` carries `company_id` and is read through `CompanyScopeService`
(invariant 1). It is append-only, enforced by the shared subscriber (invariant 2). Every endpoint
is gated by permission code (invariant 5), and geofence behaviour is read from `work_location`
configuration rather than branched in code (invariant 7). No budget or quota row is written, so
invariants 3, 4 and 8 are not in play.

**Volume** — this is the first table in the system that grows with headcount × days rather than
with documents. Indexing is therefore part of the slice, not an afterthought: the query the daily
slice will run constantly is "every punch for this employee on this local date".

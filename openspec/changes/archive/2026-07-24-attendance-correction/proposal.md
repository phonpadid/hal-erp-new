## Why

`attendance-capture` made the punch ledger append-only and gave every event a `corrects_event_id`,
with a note that a wrong punch is superseded by a new row rather than edited. Nothing has ever
written that column. The seam was left open on purpose: the *row* had somewhere to go, but the
approval that authorises it did not exist yet.

Meanwhile `attendance-daily` marks a day `INCOMPLETE` when someone punched in and never out, and
records zero worked minutes for it. That is honest — the system genuinely does not know when they
left — but it pays nobody for a day they probably worked, and the design named the correction
request as the intended remedy. This is that remedy.

Without it the only ways to fix a wrong punch are to leave it wrong or to let someone edit the
ledger, and the second would destroy the property that makes attendance evidence at all.

## What Changes

- **New `time_correction` table**, one row per correction document, naming the employee, the shift
  day being corrected, what is being asked for, and the reason. A correction is a request to add,
  move, or remove a punch — never to change a number on the daily projection.
- **Approval writes a corrective `attendance_event`**, stamped `source = MANUAL` with
  `recorded_by` set to the approver, and `corrects_event_id` pointing at the row it supersedes when
  it supersedes one. The superseded row stays readable forever, which is what makes the correction
  auditable rather than a quiet rewrite.
- **The covered day is recomputed after the approval commits**, reusing the listener seam leave
  established: the approval is never rolled back if the projection fails, and a day that did not
  catch up remains findable by comparing `computed_at` to `approved_at`.
- **Removing a punch is a supersession, not a deletion.** The ledger cannot delete, so a removal
  is recorded as a corrective row that voids its target. The daily computation must then ignore
  voided events — which is the one change this slice makes to how a day is computed.
- **A correction names a shift day, not an instant range.** The projection thinks in shift days,
  the punches it consumes are collected by the shift window, and a request phrased as "my Tuesday
  is wrong" is what a person actually means.
- **Corrections are bounded by configuration**, not left open: a per-company window of how many
  days back a correction may be requested, so a month-end cannot be reopened indefinitely once
  period close exists.
- **New permission codes** `ATTEND_CORRECTION_MANAGE` (raise one on another employee's behalf, and
  configure the window). Raising one's own uses the existing document codes, as leave and overtime do.
- **`erp_approval_system.dbml` updated** with the new table and the company window setting.

Not in this slice: editing `attendance_day` directly (it is a projection and the only way to change
it is to change what it derives from), period close, payroll export, and frontend.

## Capabilities

### New Capabilities
- `attendance-correction`: the `time_correction` record, approval writing a corrective
  `attendance_event` with `recorded_by` and `corrects_event_id`, voiding as supersession,
  recomputation of the affected day, the backdating window, and `ATTEND_CORRECTION_MANAGE`.

### Modified Capabilities
- `attendance-capture`: the ledger requirement already says a correction is a new row naming the
  one it supersedes. It does not say what a superseded row *means* to a reader — and once
  corrections exist, "superseded" has to imply "no longer counted", or the same punch is read
  twice.
- `attendance-daily`: punch collection must skip events that a later corrective row has voided or
  replaced. This is the only change to how a day is computed, and it is what makes a correction
  actually correct anything.

## Impact

**Schema** — one new table, `time_correction`, and one column on `company` for the request window.
No change to `attendance_event`: `corrects_event_id` has been there since the capture slice and is
finally written.

**Backend** — a new correction service and controller in the `attendance` module. `computeDay`
gains a filter for superseded events; `AttendanceDayService` passes the supersession information
in. An approval listener recomputes the affected day, alongside the leave one.

**Frontend** — none in this slice.

**Invariants** — `attendance_event` stays append-only and is only ever inserted into
(invariant 2); a correction is a new row, never an update or delete, which is the whole design.
`time_correction` carries `company_id` and is read through `CompanyScopeService` (invariant 1).
`attendance_day` remains a pure projection: a correction changes the ledger, and the day follows
(invariant 3). Endpoints are gated by permission code (invariant 5) and the request window is
configuration (invariant 7). No budget, quota, or FX row is written.

**Closing note** — this is the last backend slice of the attendance module. After it, every fact
the module records has a way to be captured, judged, claimed, and corrected, and what remains is
the interface.

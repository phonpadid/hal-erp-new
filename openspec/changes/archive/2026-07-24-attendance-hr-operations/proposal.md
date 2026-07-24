## Why

The period slice shipped eleven endpoints and **not one of them can be reached by a person**. Closing a month — the act that turns attendance into something payroll can pay against — is currently possible only by running a `vitest` spec. That is not a workflow; it is a test that happens to have a side effect.

The same is true either side of it: nobody can look at the whole team's attendance, nobody can enter a punch for the employee whose phone died, and nobody can rebuild a projection that went stale. Every one of those has a working endpoint and no door.

Building the screen also forces a question the period slice deliberately left open. `design.md` for that slice asked: *"Should closing require every day in the range to have been computed?"* — and left it, because the answer depended on whether recompute was scheduled or manual. On a screen it stops being theoretical: HR presses Close, and if the days were never computed **every line reads zero, silently**, and payroll pays on it.

## What Changes

### The screens

- **Attendance periods** — declare a period, see its state, close it, reopen it with a reason. The list is the month-end workflow, so it shows what closing would produce before it produces it.
- **Period detail** — the per-employee lines with their leave rows by type, the append-only close/reopen log, and the punches that landed inside the closed range and therefore changed nothing.
- **Team attendance** — everyone's computed days with filters, plus recompute for one employee or the whole company, and the stale-leave read surfaced as an operational to-do rather than an endpoint nobody calls.
- **Punch ledger** — everyone's punches, entering one on someone's behalf, and the bulk "check the crew in at 08:00" path. Correcting somebody else's punch starts here too, which is what puts `related_employee_id` on the document and makes the on-behalf case visible to every approver.

### Two backend gaps the screens expose

- **Closing shows its coverage first.** A new read answers, for a period, how many employee-days in its range have no computed row at all, and how many were computed before the last punch that touches them. The close confirmation states both figures. **Closing is NOT blocked** — a month where everybody is exempt legitimately has no rows, and refusing to close it would make an honest period unclosable. The point is that nobody closes a month of zeros without being told they are.
- **Recompute covers a range, company-wide.** `POST /attendance/days/recompute/company` takes a single date, so making a month current means thirty requests fired by hand. A period is a range; the thing that makes a period current has to be one too.

### One silent cap removed

`GET /attendance-periods/closed-events` returns at most 500 rows with no indication that it truncated. On a screen a silent cap reads as "there were only 500", so it becomes paged like every other list in the application.

## Capabilities

### New Capabilities

- `web-attendance-hr`: the HR-facing attendance screens — declaring and closing periods, reading the whole team's days and punches, recomputing, and entering attendance on somebody else's behalf.

### Modified Capabilities

- `attendance-period`: a period exposes how much of its range has been computed and how much is stale, and closing reports both. Closing remains permitted regardless — the figure is information, not a gate.
- `attendance-daily`: company-wide recomputation covers a date range rather than a single date, so a period can be made current in one action.

## Impact

**Frontend** (`front-end/`): four views under `views/attendance/`, extensions to `api/attendance.ts` and `stores/attendance.ts` for the HR surface (or a sibling `attendanceHr` store — decided in design), `NAV` entries and routes gated on `ATTEND_PERIOD_READ`, `ATTEND_DAY_READ` and `ATTEND_PUNCH_READ`, and `attendance` i18n keys in all three locales, because the parity and no-literal-text guards fail a build on either omission. New views join the smoke suite.

**Backend**: a coverage read on `AttendancePeriodService`, a range-accepting company recompute on `AttendanceDayService`, and paging on the closed-period event read. No schema change, no migration, no new table, no new permission code — every screen here is gated by codes that already exist.

**Invariants**: unchanged. Recompute already refuses a date inside a closed period, so a screen offering the button cannot reopen a frozen day by accident. Company isolation is untouched: every read is already company-scoped, and the on-behalf punch path has required `ATTEND_PUNCH_MANAGE` since the capture slice.

**Not in scope**: HR configuration — shifts, shift assignment, work locations and geofences, leave types, the correction window. Those are a later slice with a different audience and a different rhythm: configured once, then left alone. Also out: any payroll export file, and approving leave or corrections, which the existing approvals inbox already handles.

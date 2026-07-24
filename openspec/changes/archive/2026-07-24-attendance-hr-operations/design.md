## Context

Eight backend slices and one frontend slice. The self-service half now works end to end — an employee punches, reads their own days, and raises leave and corrections about themselves. The HR half has every endpoint and no screen.

The gap is not evenly distributed. The period capability is the extreme case: eleven routes, four permission codes, an append-only log, and the only way to exercise any of it is a `vitest` file. But `attendance/days` (everyone's), `attendance/events` (everyone's), the on-behalf and bulk punch paths, `days/recompute`, and `leave-requests/stale-days` are all in the same state.

Two things learned in the last two slices shape this one:

- **A screen asks questions a test does not.** The self-service slice found three authorization problems by asking what a form should send. The same thing happens here at the Close button, which forces the coverage question the period slice deferred.
- **The DI graph was never exercised.** `AttendanceModule` failed to import `DocumentEngineModule` for three slices while 1066 tests passed, because every spec constructs its services by hand. Whatever this slice adds, at least one thing must prove itself by starting the application.

## Goals / Non-Goals

**Goals:**

- HR can declare a period, see what closing it would produce, close it, and reopen it with a reason — in a browser.
- The whole team's days and punches are readable, filterable, and rebuildable, with recompute reaching a range rather than one date at a time.
- Nobody closes a month of zeros without being told the range was never computed.
- Entering attendance for somebody else stays visibly on somebody else's behalf: the document names the employee, and every approver sees it.
- Reuse: `AppDataTable`, `EmptyState`, `ErrorState`, `useFeedback`, `fb.confirm`, `PageHeader`, the `can` directive, `mountView`. This slice introduces no new frontend convention.

**Non-Goals:**

- HR configuration — shifts, assignments, work locations and geofences, leave types, the correction window. Later slice.
- Payroll export in any format.
- Approving leave, overtime or corrections. The approvals inbox already does that, and building a second approval surface inside attendance would be two places to keep in agreement.
- Blocking a close. See decision 2.
- Any new permission code. Everything here is already gated.

## Decisions

### 1. A sibling `attendanceHr` store, not more actions on `attendance`

The self-service store has one property that is worth protecting: it holds nothing about *whose* attendance it is, because every endpoint behind it resolves the caller. Adding `employeeId` filters, an all-employees list and an on-behalf punch to that same store would put a subject into it, and the next person reading `useAttendanceStore()` would no longer be able to tell which half they were touching.

Two stores. `attendance` stays about the caller; `attendanceHr` is about other people, and every state field in it says so.

*Alternative rejected:* one store with a namespace inside. Same file, same import, same ambiguity — the separation would be a naming convention rather than a boundary.

### 2. Closing shows coverage; closing is not blocked

The period slice left this open: *"Should closing require every day in the range to have been computed? A stricter close would refuse until the range is complete."*

The screen decides it. **Show, do not block.**

Blocking is wrong because a period with no computed rows is sometimes correct: a company whose staff are all `attendance_required = false` has an entirely legitimate month of nothing, and a close that refuses it makes an honest period permanently unclosable. Blocking would also invite the workaround of computing junk rows to satisfy a gate.

Silence is worse, though, and that is the real failure this fixes. Today `close()` summarises whatever `attendance_day` holds; a range nobody ever computed produces a full set of lines reading zero, and they look exactly like a month where nobody worked. The close confirmation therefore states two figures — employee-days with no row, and employee-days computed before the last punch that touches them — and offers to recompute the range first.

*Two numbers, not one,* because they mean different things: "never computed" is work not yet done, "stale" is work overtaken by a later punch. Collapsing them would hide which one a given month has.

### 3. Coverage is derived, never stored

The coverage figures are a query over `attendance_day.computed_at` against the newest `attendance_event` touching each employee-day, plus a count of expected employee-days with no row at all. Nothing is stored.

This is the same reasoning `staleLeaveDays` used when the leave slice needed the same shape: *"needs no stored state and no outbox — `computed_at` was added so staleness is visible rather than assumed."* A stored coverage counter would be a third thing able to disagree with the two it summarises.

### 4. Company recompute takes a range

`POST /attendance/days/recompute/company` accepts one date. A period is a range, so making one current means firing a request per day and hoping none of them fails silently in the middle.

The route gains `dateFrom` / `dateTo`, with `dateTo` optional and defaulting to `dateFrom` — which keeps every existing caller and every existing test working unchanged, the same shape `RecomputeDaysDto` already uses for a single employee.

Per-employee-day transactions stay exactly as they are: a failure on one person's Tuesday must not roll back a month of correct rows for everybody else. That is already true and this must not quietly change it, so the range loop reuses `recomputeRange` per employee rather than inventing a second path.

*Risk:* a company-month is employees × days transactions. For a few hundred people over thirty days that is thousands of small commits, and it is a month-end action rather than a request path. The screen therefore reports progress as a count rather than pretending it is instant, and the design notes the ceiling rather than discovering it.

### 5. Correcting somebody else's punch starts from their punch

HR does not fill in a correction form and then choose whose attendance it is about. They are looking at a punch that is wrong, and they act on it.

So the on-behalf correction begins in the punch ledger, from the row itself, and the document it creates carries `related_employee_id`. That is not a convenience — it is what makes the beneficiary rule work: the correction service resolves the subject from the document, so an on-behalf correction is one whose subject every approver can see, and there is no field in the request body that could name somebody quietly.

The self-service correction form is **not** modified. Adding a "for whom" picker to it would put the subject back into the requester's hands, which is exactly what the last slice took away.

### 6. `closed-events` becomes a paged read

It caps at 500 rows and says nothing about it. In a spec that is invisible; on a screen it reads as "there were only 500", which is a lie the reader has no way to detect.

Paged like every other list, using the `Paginated<T>` shape the whole api layer already returns. A cap that reports itself is a cap; one that does not is a defect waiting for a big enough month.

### 7. Recompute is offered, and the closed-period refusal is left to speak

The team screen offers a recompute button for a range that may overlap a closed period. Nothing special is done about that: `recomputeRange` already skips closed dates and `recomputeDay` already refuses one outright, both with a message naming the period.

Pre-filtering the button in the client would put a second copy of the closed-period rule in the frontend, where it would drift. The screen shows what the server said.

## Risks / Trade-offs

**A company-wide range recompute is thousands of transactions.** → It is a month-end action, not a request path, and per-day commits are what make a partial run safe to re-run. The screen reports a count so a slow one looks slow rather than broken. If it ever needs to be faster the fix is batching inside the service, with no model consequence.

**Coverage is computed on every period read.** → Two aggregate queries over one company's range, both on indexed columns (`(company_id, shift_date)` exists on `attendance_day`). If a period list of many months becomes slow, coverage moves to the detail read only — a change inside the service.

**HR screens carry more permission codes than any previous frontend slice.** → Four period codes plus the day and punch reads, and the guard takes exactly one code per route. Each screen is gated on the code for its own read, and the writes inside are gated separately with `auth.can(...)`, which is the pattern `QuotaAdminView` already uses. A permission spec enumerates every route, as the backend one does.

**Bulk punch can enter a wrong instant for a whole crew.** → It already can; this slice only gives it a door. The confirmation names the number of employees and the instant, and `fb.confirm` is used because it is genuinely destructive-adjacent — the ledger is append-only, so a bulk mistake is corrected by a further correction rather than undone.

**Two attendance stores could drift.** → They share `api/attendance.ts` types and nothing else, deliberately. The self-service store must stay unable to name an employee; that is the property being protected, and a shared base class would erode it.

## Migration Plan

No database change, no migration, no new permission code. The backend edits are additive: one new read, one widened DTO, one read made paged.

The widened `recompute/company` keeps `dateTo` optional so every existing caller and spec is unaffected. The paged `closed-events` changes its response shape from an array to `Paginated<T>` — a breaking change for any consumer, of which there is exactly one, added in the previous slice and updated here.

Rollback is removing the frontend files and reverting three backend edits; nothing persistent is created.

## Open Questions

- **Should the team screen let HR recompute a single employee-day from the row?** It is one click from a place where the problem is visible. Left out for now because it multiplies the recompute surface, and the range action covers it; revisit if HR ends up filtering to one person to press it.
- **Should a period list show the closed periods' totals?** A month's worked minutes across everybody is a number somebody will ask for. It is also a report rather than an operation, and reports live in their own capability — noted so the answer is a decision rather than an omission.

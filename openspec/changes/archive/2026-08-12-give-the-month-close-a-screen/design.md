# Design

## D1. The close is refused, not warned — so there is no "close anyway"

`AttendancePeriodsView` is the layout template, and its central affordance is the one thing this
screen must not copy. Attendance shows coverage, then offers **Close anyway**, deliberately: a
company whose staff are all exempt has a legitimately empty month, and refusing it would leave an
honest period permanently open.

`AccountingPeriodService.close` has no such branch. It throws on:

1. an earlier period still open — `Period 'X' (start to end) is still open; close it before 'Y'`
2. postings the company owes — `Period 'X' still owes N posting(s): TYPE DOC, …`
3. `RETAINED_EARNINGS` unmapped, when this is the year's final period

Each message names the obstacle. The screen shows the server's message verbatim rather than
translating it, for the same reason the attendance overlap refusal is shown verbatim: a translated
message would have to re-derive which period blocks and which postings are owed, and would drift
from the rule that produced it.

**Rejected: a pre-flight check.** The screen could call `GET /journal/undelivered` before enabling
the close button. That reads better and costs a permission dependency — `GL_VIEW`, which a
period-closer need not hold — to learn something the refusal already says, in more detail, at the
moment it matters. The close is cheap to attempt and safe to fail: it is transactional, and a
refusal leaves the period open.

## D2. Declaring a period needs a fiscal year the declarer may not be allowed to list

`DeclarePeriodDto.fiscalYearId` is required. The only endpoint that lists fiscal years is
`GET /fiscal-years`, gated by `FISCAL_YEAR_MANAGE` — a different code from `PERIOD_MANAGE`, held by
a different role in principle.

Three ways out:

- **(a) Gate the declare action on both codes.** Honest, no backend change, and wrong for a company
  that separates the roles: their accountant can close months but never declare one.
- **(b) Derive the year list from the periods already declared.** Works for every period after the
  first and fails for the first, which is the one that matters.
- **(c) Add a selectable-years endpoint under a period code.** Correct, and a backend change this
  frontend-only change should not smuggle in.

**Chosen: (a), with the gap stated on the screen.** The declare control requires both codes; when
`PERIOD_MANAGE` is held without `FISCAL_YEAR_MANAGE`, the screen says the fiscal-year list is
unavailable rather than rendering an empty dropdown that silently cannot be satisfied. (c) is the
real fix and belongs in its own change; recording it here is how it stays visible.

## D3. Closing the year's final period closes the year, and the screen says so first

`close` calls `closeYearIfFinalPeriod` before flipping the status: the closing entry is dated the
year's last day, inside the period being closed, so it must post while that period is still open.

The operator sees one button and gets two acts. Reopening the period afterwards does not undo the
second — `closeYear` is keyed `(YEAR_CLOSE, fiscalYearId)`, so a reopen-and-reclose finds the entry
already there and posts nothing. The confirmation therefore states, when the period being closed is
the year's last, that the year closes with it. Stated before the click, because it cannot be
usefully stated after.

## D4. No DRAFT, no edit

`AccountingPeriodStatus` is `OPEN | CLOSED` — there is no DRAFT, and no update endpoint. The
attendance screen's edit-a-draft affordance has nothing to bind to and is dropped. A period declared
wrongly is a gap this change does not fill; it belongs with the backend change that would allow it.

## D5. The list is an unpaginated array with an unpopulated fiscal year

`AccountingPeriodService.list()` returns `find(AccountingPeriod, {}, { orderBy: { periodStart: 'ASC' } })`
— no pagination and no `populate`, so `fiscalYear` serializes as an id, not an object. Consequences,
both accepted rather than worked around:

- The table uses a plain `DataTable`, not `AppDataTable` with paging. A company declares twelve
  periods a year; paging is machinery for a problem that does not exist yet.
- There is no fiscal-year column. Showing a year label would mean fetching years the viewer may not
  be permitted to read (D2), to label rows that are already ordered by date and named by their code.

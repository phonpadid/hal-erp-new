# Design

## D1. The log row is written inside the declare's transaction

`declare()` creates the period and flushes. The log row is created before that flush, so both rows
land together or neither does.

The alternative — writing the log after the period is created — has a window in which a period
exists with no record of its creation, and that window is exactly the failure this change exists to
close. It is also how `close()` and `reopen()` already work: `recordAction` persists into the same
EntityManager and the caller's flush commits both.

## D2. The declared range goes in the reason column

`accounting_period_log` carries `action`, `acted_by`, `acted_at` and `reason`. A declare has no
reason in the sense a reopen does — nobody is justifying it — but it does have the one fact worth
auditing: the range that was set.

So the row records `2026-08-01 to 2026-08-31` in `reason`. Two alternatives were considered:

- **Leave it null.** The row then says only "somebody declared something at 10:04". The range is on
  the period row, but the period row is editable in principle and carries only its *current* range;
  an audit trail that cannot say what was originally set is answering a different question.
- **Add `period_start` / `period_end` columns to the log.** Correct in the abstract and wrong here:
  the log is generic over actions, three of which have no range, and widening the table for one
  action's payload is how audit tables become half-empty. The DBML notes `reason` as free text.

The string is the same `YYYY-MM-DD to YYYY-MM-DD` shape the close refusal already uses when naming
a blocking period, so the format is not invented here.

## D3. No backfill, and the absence is the honest record

Periods declared before this change have no declare row. The temptation is to write one at
migration time from `accounting_period.created_at`.

That would be fabricating an audit record. `created_at` is close to the declare's instant, but the
actor is unknown — the column does not exist on the period — and a log row needs one. Filling it
with a system user, or the company's first admin, produces a record that says a specific person did
something they may not have done. An audit trail whose oldest entries are guesses is worse than one
that starts where the recording started.

So the migration touches the constraint and no data. A period with a close row and no declare row is
readable as "declared before this was recorded", which is true, where a fabricated row would be
false in a way nobody could later detect.

## D4. `DECLARE` is not the same as an update, and this change does not pretend otherwise

Recording the declare makes the *creation* auditable. It does nothing about a period whose range is
later wrong, because there is no way to change a period's range at all — no update endpoint, no
service method.

That is a real gap and it is worth stating rather than implying this change closed it: a period
declared wrongly is today fixed by writing to the database, which no log records. Adding an update
path is its own change, and it would need this one first — an amend log row has nothing to amend
until the original is recorded.

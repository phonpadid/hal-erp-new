## 1. The action

- [x] 1.1 `PeriodAction.DECLARE`, first in the enum.
- [x] 1.2 `erp_approval_system.dbml` — `DECLARE` in `Enum period_action`, with a note.
- [x] 1.3 `Migration20260816000000` widens `accounting_period_log_action_check` to admit `DECLARE`.
      `down()` raises before narrowing if any `DECLARE` row exists, rather than dropping the
      constraint and leaving rows the schema forbids — a down migration that cannot honestly reverse
      should say so where it runs.

## 2. Writing it

- [x] 2.1 `declare()` calls `recordAction` before its flush (design D1).
- [x] 2.2 The reason carries the range as `YYYY-MM-DD to YYYY-MM-DD` (design D2).
- [x] 2.3 No backfill — the migration alters the constraint and touches no data.

## 3. The client

- [x] 3.1 `PeriodLogEntry.action` admits `'DECLARE'`.
- [x] 3.2 `gl.periods.log.actions.DECLARE` in `en`, `la` and `zh`. No view change.

## 4. Tests

- [x] 4.1 Declaring writes one row with `DECLARE`, the actor, and the range.
- [x] 4.2 The case asserting a declared period's log is EMPTY now asserts it holds the declare,
      with a comment saying what changed.
- [x] 4.3 TWO existing cases had to change, not one: the log-order case in the new describe block,
      and `reopens with a reason and logs both actions, append-only` further up the file, which
      pinned `[CLOSE, REOPEN]` and now pins `[DECLARE, CLOSE, REOPEN]`. The second was found by
      running the suite, not by reading — worth recording, because a grep for the log assertions
      would have missed it.
- [x] 4.4 A declare that fails AT THE FLUSH leaves neither row.
      The first version used a bad range, which never reaches the write: every range check runs
      before `em.create`. Rewritten to use a duplicate code, which `(company, code)` unique refuses
      at the flush, with both rows already staged.
- [x] 4.5 Negative check: removing `recordAction` from `declare()` reddens 3 cases; dropping the
      range from the reason reddens 1.

      **NOT covered, and stated rather than implied:** moving the log write to AFTER the period's
      flush — the ordering design D1 argues for — reddens nothing. The only failure that would
      distinguish the two orderings is one where the period insert succeeds and the log insert
      fails, and inducing that needs a mocked EntityManager. The requirement stands and the code
      satisfies it; the automated suite does not discriminate it, and pretending otherwise would be
      worse than the gap.

## 5. Checks

- [x] 5.1 `nest build` clean, frontend `typecheck` clean, i18n + accounting views 124 tests pass.
      Backend suite reported in the summary. Exit codes read with `PIPESTATUS`.
- [x] 5.2 `npm run migration:up` applied `Migration20260816000000` against the real database and
      exited 0 — not merely inspected.
- [x] 5.3 `openspec validate --all` passes.
- [x] 5.4 `openspec/specs/**` untouched.

## 1. The projection

- [x] 1.1 `AttendancePeriodService.log()` returns
      `{ id, action, actedAt, reason, actedBy: { id, username } }` (design D1).
- [x] 1.2 The declared return type changed with it, so a caller reading a removed field fails to
      compile.

## 2. Tests

- [x] 2.1 `Object.keys(actedBy)` is exactly `['id', 'username']`, added to the existing reopen-log
      case rather than as a separate one — the assertion belongs with the read it constrains.
- [x] 2.2 The other two callers of `log()` — `verify-dev-hr-operations` and `verify-dev-period` —
      read only `action`, `reason` and `actedBy` truthiness, all of which the projection keeps.
      Checked by reading them, then confirmed by the suite.
- [x] 2.3 Negative check: returning the entity again reddens the case.

## 3. The client is the evidence

- [x] 3.1 No client file touched. `typecheck` clean and the frontend suite unchanged — the narrow
      shape was always the declared contract (design D3).

## 4. Checks

- [x] 4.1 Backend 1410 passed / 36 skipped, `nest build` clean, frontend `typecheck` clean.
- [x] 4.2 `openspec validate --all` passes.
- [x] 4.3 `openspec/specs/**` untouched.

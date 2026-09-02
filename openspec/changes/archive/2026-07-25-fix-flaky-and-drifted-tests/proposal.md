## Why

The test suites are the only thing standing between a change and a `pm2 restart` on the
production box, and their signal is currently unreliable in both halves of the repo: the
backend suite fails every Saturday, and the frontend suite exits non-zero even when all
621 tests pass. A red result that nobody caused teaches the team to
ignore red results, so this has to be repaired before the suites can be trusted — or gated on.

## What Changes

- Make `leave-request.service.spec.ts` pick a future date the fixture shift actually works,
  instead of `Date.now() + 86_400_000`. Today the test asks for leave "tomorrow"; when tomorrow
  is a Sunday the request covers no working days, the service rejects it with `This request
  covers no working days` before it can reach the advance-notice rule the test is asserting,
  and the suite reports `1 failed | 1074 passed`. The fixture shift works Saturday as a half
  day, so the failure lands on Saturdays only — once a week, which is often enough to be
  noticed and rare enough to be dismissed as a fluke.
- Add the missing `movementDocTypes` member to the `budgetsApi` mock in
  `views/budgets/waterfall.spec.ts`, so `BudgetDetailView`'s `onMounted` no longer raises an
  unhandled rejection that Vitest attributes to whichever file happens to be running.
- Stop `VendorBankAccountsPanel.spec.ts` from clearing `document.body` between tests while
  earlier wrappers are still mounted; unmount them instead, so a stale component cannot patch
  into a detached tree and throw `Cannot read properties of null (reading 'insertBefore')`.
- Clear the four TypeScript errors that make `pnpm --filter front-end run ci` fail before it
  reaches the tests at all: two unused bindings (`vi` in `attendance-hr.spec.ts`, `t` in
  `StockOnHandView.vue`) and two `Record<string, unknown>` index-signature errors in
  `api/attendanceHr.ts`, where `TeamDayFilters` and `PunchFilters` become type aliases so they
  carry the implicit index signature `dropEmpty` requires. This restores conformance with an
  existing requirement — `web-ui-quality`'s *Type checking gates the build* — rather than adding
  a new one.
- Record the resulting rule in the specs: a suite that passes must also exit clean, and a
  suite's result must not depend on the calendar day it runs.

No runtime behavior changes and nothing visible to any user changes. The only production files
touched are type-level: two exported interfaces become type aliases, and a view drops an i18n
binding it never used (its template resolves text through the global `$t`). This is repair to
the instruments, not to the machine.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `platform-foundation`: the backend test-tooling requirement gains determinism — a spec's
  result must not depend on the day of the week the suite runs, and a spec that needs a future
  working date must derive one rather than assume tomorrow is one.
- `web-ui-quality`: a new requirement that the web test run exits clean — every module mock
  must satisfy the surface the component under test actually calls, and specs must unmount what
  they mount rather than clearing the document out from under a live component.

## Impact

- `back/src/modules/attendance/leave-request.service.spec.ts` — one test's date fixture.
- `front-end/src/views/budgets/waterfall.spec.ts` — one `vi.mock` factory.
- `front-end/src/components/master-data/VendorBankAccountsPanel.spec.ts` — teardown.
- `front-end/src/views/attendance/attendance-hr.spec.ts` — one unused import.
- `front-end/src/views/inventory/StockOnHandView.vue` — one unused i18n binding, identical to
  `master`, so the typecheck failure it causes predates this branch.
- `front-end/src/api/attendanceHr.ts` — `TeamDayFilters` and `PunchFilters` become type aliases.
- No entity, migration, DTO, endpoint, or permission code is touched, so no invariant in
  CLAUDE.md or `openspec/project.md` is at risk. Company isolation, the append-only ledgers,
  the balance derivation, and the permission-code guards are all untouched.
- Unblocks a later, separate change that gates `.github/workflows/deploy.yml` on the suites;
  that gate is deliberately **not** in this change, because gating on a suite that is red every
  Friday and Saturday would simply teach everyone to bypass the gate.

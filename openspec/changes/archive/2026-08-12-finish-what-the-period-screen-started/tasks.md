## 1. The fiscal years a period can be declared into

- [x] 1.1 `AccountingPeriodService.selectableFiscalYears()` — the active company's `OPEN` fiscal
      years, ordered by year, projected to `{ id, year, startDate, endDate }`. Uses the existing
      `FISCAL_YEAR_OPEN` constant rather than a literal.
- [x] 1.2 Closed years are excluded (design D1).
- [x] 1.3 `GET /accounting-periods/fiscal-years` under `PERIOD_MANAGE`, on the period controller
      (design D1).
      Route order checked rather than assumed: the controller has no `@Get(':id')`, so nothing could
      shadow it. Declared above `:id/log` anyway, so the next parameterised route added cannot.

## 2. The period log

- [x] 2.1 `AccountingPeriodService.log(periodId)` — the period's log rows, oldest first, scoped to
      the active company.
      The class already had a `private log()` that WRITES a row, so TypeScript refused the second
      definition. The writer is now `recordAction`, which says what it does; the reader keeps the
      name the endpoint uses. Three call sites moved.
- [x] 2.2 Projected to `{ id, action, actedAt, reason, actedBy: { id, username } }` (design D2).
- [x] 2.3 `GET /accounting-periods/:id/log` under `PERIOD_VIEW` (design D3).
- [x] 2.4 A period from another company is refused — `require()` runs on the scoped EM first, so a
      foreign id is a 404 rather than a readable log.

## 3. The client

- [x] 3.1 `api/accountingPeriods.ts` — `selectableFiscalYears()`, `log(id)`, and their types.
      `PeriodLogEntry.action` is `'CLOSE' | 'REOPEN'` — see the finding below.
- [x] 3.2 `stores/accountingPeriods.ts` — `fiscalYears`, `log`, `logPeriodId`, `loadFiscalYears`,
      `loadLog`. One log at a time, not a map (design D5).

## 4. The screen

- [x] 4.1 The declare dialog reads years from the store and no longer consults
      `FISCAL_YEAR_MANAGE`. `canListYears` and the `org` store import are gone.
- [x] 4.2 No open fiscal year gets its own message (design D4).
- [x] 4.3 A history control per row opening a panel with action, actor, moment and reason.
- [x] 4.4 The log is fetched on open (design D5).
- [x] 4.5 `fiscalYearsUnavailable` removed from all three locales; `noOpenFiscalYear`, `history` and
      the `log.*` keys added.

## 5. Tests

- [x] 5.1 Backend: the open years are returned.
- [x] 5.2 Backend: a closed year is excluded, with both kinds present.
      The first version created only the CLOSED year and expected the SEEDED year to be open. It
      failed: cases earlier in the same file close periods, and closing a year's last period closes
      the year. The test now creates both years itself rather than assuming a fixture another case
      can change.
- [x] 5.3 Backend: company isolation on both reads.
- [x] 5.4 Backend: close, reopen, close read back in order with the reopen's reason and actor.
- [x] 5.5 Backend: `Object.keys(actedBy)` is exactly `['id', 'username']`, so a field added to
      `AppUser` later cannot arrive here silently.
      This case originally declared its own period and closed it, which was refused — periods close
      in order and the previous case's August was still open. It now reads the log the earlier case
      produced.
- [x] 5.6 Frontend: a `PERIOD_MANAGE` holder without `FISCAL_YEAR_MANAGE` gets a working selector —
      the exact permission set that used to be blocked.
- [x] 5.7 Frontend: no open fiscal year states it and renders no selector.
- [x] 5.8 Frontend: rendering the list requests no log; opening one panel requests exactly that
      period's log.
- [x] 5.9 The existing case asserting the "unavailable" message is rewritten, not deleted — it now
      asserts the opposite, with a comment saying what changed and why.
- [x] 5.10 Negative check run for five behaviours, each by breaking the code and confirming the
      matching case goes red: the status filter removed (2 red), the actor returned as an entity,
      the scope check skipped, the selector rendered unconditionally, and the log loaded with the
      list.

## 6. Checks

- [x] 6.1 Frontend 88 files / 769 tests, `typecheck` clean, `nest build` clean (exit checked with
      `PIPESTATUS`, not the exit of the `tail` it was piped into). Backend suite reported below.
- [x] 6.2 `openspec validate --all` passes.
- [x] 6.3 `grep -rn "fiscalYearsUnavailable" front-end/src` returns nothing.
- [x] 6.4 `openspec/specs/**` untouched.

## 7. A finding that changed the specification mid-implementation

- [x] 7.1 The proposal claimed the service "already writes `DECLARE`, `CLOSE` and `REOPEN`". It does
      not. `PeriodAction` holds `CLOSE` and `REOPEN` only, the migration constrains the column to
      those two (`check ("action" in ('CLOSE', 'REOPEN'))`), and `declare()` writes no row.
- [x] 7.2 The artifacts were corrected rather than the code stretched: the requirement, the two
      affected scenarios and the proposal now say closes and reopens, and a scenario was added for a
      declared period's empty log. Adding `DECLARE` would need an enum value, a migration and a DBML
      change — which this change had already promised not to do.
- [x] 7.3 Recorded in the proposal as a finding for a later change: a period's declare leaves no
      trace, and the range a period was declared with is exactly the kind of thing an auditor asks
      about.

# Finish what the period screen started

## Why

The accounting-periods screen shipped three changes ago with two holes it recorded rather than
filled. Both are now the oldest debts in the accounting work, and both are small.

**A period manager cannot declare a period.** `DeclarePeriodDto.fiscalYearId` is required, and the
only endpoint that lists fiscal years is `GET /fiscal-years`, gated by `FISCAL_YEAR_MANAGE` — a code
from a different module, held by whoever administers the organisation. The screen currently tells a
`PERIOD_MANAGE` holder that the fiscal-year list is unavailable and stops. That message was the
honest thing to render at the time; it is not a feature.

**The reason a reopen demands is written and never read.** `Reopening Is Permitted, Ordered, And
Audited` requires a reason, `accounting_period_log` stores it with the actor and the timestamp, and
nothing exposes it. An auditor asking who reopened November and why cannot be answered from the app,
though the answer is in the database. A control that costs a sentence and then discards it teaches
people to type anything.

## What Changes

**The years a period can be declared into**

- `GET /accounting-periods/fiscal-years` (new) under `PERIOD_MANAGE` — the open fiscal years of the
  active company, as `{ id, year, startDate, endDate }`.
- Not a new endpoint on the fiscal-year controller. `RequirePermissions` is AND, not OR, so there is
  no way to say "either code"; and the question this answers is not "list the fiscal years" but
  "which years may I declare into". See design D1.
- The declare dialog uses it and drops the "unavailable" message.

**The period log**

- `GET /accounting-periods/:id/log` (new) under `PERIOD_VIEW` — the append-only record of closes and
  reopens, with who and when and why.
- A projection, not the entity: the actor is `{ id, username }` and nothing else. See design D2.
- A log panel on the periods screen, reachable per row.

## What This Change Does NOT Do

- No change to `RequirePermissions`. Adding OR semantics to the authorization guard to serve one
  screen would be the tail wagging the dog; the endpoint moves instead.
- No edit or delete of a period. Still no update endpoint, and this change does not add one.
- No change to what is logged. `AccountingPeriodService` writes `CLOSE` and `REOPEN`; this exposes
  them.

## A finding this change reports rather than fixes

**Declaring a period leaves no trace.** `PeriodAction` holds `CLOSE` and `REOPEN` only, the
migration constrains the column to those two (`check ("action" in ('CLOSE', 'REOPEN'))`), and
`declare()` writes no log row. So the log answers "who closed this and who reopened it" and cannot
answer "who declared it, and when".

That is a gap worth closing — the declare is what fixes a company's book calendar, and a period
declared with the wrong range is exactly the kind of thing an auditor would ask about. But closing
it means a new enum value, a migration to widen the check constraint, and a DBML change. This change
said it would alter nothing about what is logged, and doing it here would make that false a second
time.

An earlier draft of this proposal claimed the service already logged declares. It does not; the
claim was written from the enum's shape rather than from the code, and the specification was
corrected to match reality when the implementation reached it.

## Impact

- Affected specs: `accounting-period`, `web-accounting`
- Affected code: `back/src/modules/accounting/period/` (controller, service),
  `front-end/src/api/accountingPeriods.ts`, `stores/accountingPeriods.ts`,
  `views/accounting/AccountingPeriodsView.vue`, `i18n/locales/{en,la,zh}/gl.ts`
- No migration — both tables exist and both are already written.

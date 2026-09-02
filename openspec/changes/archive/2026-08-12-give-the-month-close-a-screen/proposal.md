# Give the month close a screen

## Why

`accounting_period` has a full REST surface and no way to reach it. Four endpoints, four permission
codes, no client:

| Endpoint | Permission | Client |
| --- | --- | --- |
| `GET /accounting-periods` | `PERIOD_VIEW` | — |
| `POST /accounting-periods` | `PERIOD_MANAGE` | — |
| `POST /accounting-periods/:id/close` | `PERIOD_CLOSE` | — |
| `POST /accounting-periods/:id/reopen` | `PERIOD_REOPEN` | — |

`grep -rn 'PERIOD_VIEW\|PERIOD_MANAGE\|PERIOD_CLOSE\|PERIOD_REOPEN' front-end/src` returns nothing.
Closing a month — the act that makes the ledger reportable and stops backdated entries — is
reachable only by curl. The `PeriodGuardService` that refuses entries into closed periods is
therefore guarding a state no operator can enter.

This is the first of three changes bringing the accounting screens under `web-accounting`. It takes
the periods screen: the one whose absence stops the accounting month from working at all.

## What Changes

- `front-end/src/api/accountingPeriods.ts` (new) — list, declare, close, reopen.
- `front-end/src/stores/accountingPeriods.ts` (new).
- `front-end/src/views/accounting/AccountingPeriodsView.vue` (new) — the period list, a declare
  dialog, a close confirmation, and a reopen dialog that requires a reason.
- Route `/accounting-periods` under `PERIOD_VIEW`, nav entry in the existing `accounting` section.
- i18n keys in `en`, `la` and `zh`.
- Component tests, and the view added to the smoke registry.

`AttendancePeriodsView.vue` is the nearest existing screen and the starting point for the layout —
but **not** for the close. Attendance warns about coverage and offers "close anyway"; the accounting
close is refused outright by the server when an earlier period is open or a posting is undelivered.
Copying that affordance would put a button on the screen that cannot work. See design D1.

## What This Change Does NOT Do

- The period log (`accounting_period_log` — who closed what, when, and why it was reopened) has no
  endpoint. Surfacing it needs a backend addition and is not in scope.
- The undelivered-postings list that a blocked close points at is B3's screen. Until then the
  refusal message names the postings; the operator cannot yet click through to them.
- No backend change.

## Impact

- Affected specs: `web-accounting`
- Affected code: new files above, plus `router/routes.ts`, `layouts/store/layout.store.ts`,
  `i18n/locales/{en,la,zh}/`, `test/smoke/views.smoke.spec.ts`
- Known limitation carried by this change: declaring a period needs a `fiscalYearId`, and listing
  fiscal years is gated by `FISCAL_YEAR_MANAGE`, not by `PERIOD_MANAGE`. See design D2.

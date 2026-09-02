## Why

Seven backend slices made attendance complete — punches, days, leave, overtime, corrections, period close — and **not one of them can be reached by the people it is about**. There is no `views/attendance/`, no `api/attendance.ts`, no store, no nav entry. Every proof so far has been a spec run or a query against the dev database.

Self-service is the half that matters most: the punch screen is the only part of this module an ordinary employee touches, and it is the only thing that puts real data into the ledger. Everything downstream — the daily projection, leave excusing an absence, a correction fixing a forgotten check-out, a closed period's line — derives from a button somebody presses on a phone.

Building it also **surfaces two permission gaps** that no backend slice could have found on its own, because only a screen used by someone holding the minimum codes exposes them.

## What Changes

### The screens

- **My attendance** (`/attendance/me`) — the punch screen. Check in and check out with the device's coordinates, today's punches in order, and whether you are currently in or out. Mobile-first: it is the first view in this codebase that is not a `PageHeader` + `AppDataTable` desktop page, because it is the first one used standing at a gate.
- **My days** — the computed projection for the caller: status, worked minutes, late minutes and late *occurrences* kept visibly apart, overtime by kind. Read-only, because it is derived.
- **Request leave** — a form that previews the days it will actually charge *before* submitting, since leave charges working days only and a five-day range across a holiday costs four.
- **Request a time correction** — pick the punch that was wrong from that day's list, or add one that was never recorded. The requester picks a row rather than describing a time, which is what `GET /time-corrections/correctable` was built for.

### Two permission gaps this surfaces — **BREAKING** for anyone already granting these codes

- **`ATTEND_DAY_SELF` (new).** `GET /attendance/days/me` is gated on `ATTEND_DAY_READ` — the same code as `GET /attendance/days`, which lists **everybody**. So letting an employee see their own attendance today means letting them see the whole company's. The capture slice got this exactly right with `ATTEND_PUNCH_SELF` / `ATTEND_PUNCH_READ` / `ATTEND_PUNCH_MANAGE`; the daily slice simply did not have a self-service caller to reveal the omission.
- **Correctable punches must be readable about yourself.** `GET /time-corrections/correctable` is gated on `ATTEND_PUNCH_READ` — other people's punches. An employee holding only `ATTEND_PUNCH_SELF` therefore cannot see which of their *own* punches to name, and would have to describe one by time — precisely the failure mode the correction slice added that endpoint to prevent.

### Shared validation, not duplicated validation

Form schemas go in `@erp/shared`, and the three backend DTOs these forms post to (`PunchSelfDto`, leave create, correction create) move from class-validator to the existing `ZodValidationPipe`. CLAUDE.md's rule is that client and server validation must not drift; writing a second copy of the punch rules in the frontend would create the drift rather than avoid it.

### Two new frontend conventions

- `composables/useGeolocation.ts` — the first use of `navigator.geolocation` in this codebase. Coordinates become **decimal strings**, never JS numbers, for the same reason money does.
- A mobile-first view shell. Called out explicitly rather than assumed, because there is no precedent to follow.

## Capabilities

### New Capabilities

- `web-attendance-self`: the employee-facing attendance screens — punching with location, reading your own days, and raising leave and correction requests about yourself.

### Modified Capabilities

- `attendance-daily`: the caller's own days get their own permission code, `ATTEND_DAY_SELF`, so seeing your attendance no longer requires the power to see everyone's.
- `attendance-correction`: the correctable-punches read gains a requirement it never had — the endpoint was built in the correction slice but never specified — stating that it is authorized by `ATTEND_PUNCH_SELF` when the employee asked about is the caller, and by `ATTEND_PUNCH_READ` otherwise.

## Impact

**Frontend** (`front-end/`): a new `api/attendance.ts`, `stores/attendance.ts`, four views under `views/attendance/`, `composables/useGeolocation.ts`, a `nav.attendance` entry in `layouts/store/layout.store.ts`, routes in `router/routes.ts`, and `i18n/locales/{en,la,zh}/attendance.ts` — all three, because `i18n.parity.spec.ts` fails on a missing key in any locale and `no-literal-text.spec.ts` fails on any literal text in a view template. New views join `test/smoke/views.smoke.spec.ts`.

**Shared** (`shared/src/index.ts`): `punchSelfSchema`, `leaveRequestCreateSchema`, `timeCorrectionCreateSchema` and their inferred types. Needs `pnpm build` in `shared/` before the backend sees them.

**Backend**: `ATTEND_DAY_SELF` added to the attendance permission codes and applied to `GET /attendance/days/me`; the correctable-punches route re-gated with a self-or-read rule; three DTOs moved to `ZodValidationPipe`. No schema change, no migration, no new table.

**Invariants**: company isolation is unchanged — every self-service endpoint already resolves the employee from the caller's account inside the active company and cannot name another. Invariant 5 is the point of the whole permission section: authorize on codes, and on codes that mean what they say. The client guard is UX only; the server still enforces, and the permission tests already assert that.

**Not in scope**: HR operations (everyone's days, backfilling punches, recompute, closing a period) and HR configuration (shifts, assignments, work locations, leave types) — two later slices. Also out: offline punching, push notifications, and any PWA or service-worker work.

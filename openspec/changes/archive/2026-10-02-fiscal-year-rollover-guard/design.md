## Context

- **No year preparation runs on its own.** HAL's fiscal year is the calendar year. No cron or seed
  prepares a new one. The schedulers that exist cover SLA notifications, the successor outbox and
  the GL posting retries.
- **The open-year check happens too late.** Submit resolves the open fiscal year from
  `new Date().toISOString().slice(0,10)` (UTC) through `FiscalYearService.resolveOpenPeriod`, and
  only for `requires_budget` types. A requester finds the missing year after filling the form.
- **The picker ignores the year.** `BudgetService.listSelectable` returns every `ACTIVE` budget of
  the company, from any year.
- **Numbering uses the UTC year.** `DocumentService.create` (and the adjustment, transfer and plan
  services) number with `new Date().getUTCFullYear()`.
- **A company-local clock already exists.** `common/time/company-clock.ts#localDateIn(instant, tz)`
  is already used by attendance, reporting and the "day money moved" check. `company.timezone` is
  `NOT NULL` and defaults to `Asia/Bangkok`.
- **Two ways to close a year exist and stay.** `FiscalYearService.close` (the page's confirmed
  Close button) flips the status. The fuller close lives in `AccountingPeriodService` and runs only
  for companies that declare accounting periods; HAL has not used them so far (to be confirmed).

The user decided:
- Block **creation** of `requires_budget` documents only.
- Warn admins **30 days** ahead.
- Make the warning cover budget readiness.

## Goals / Non-Goals

**Goals:**
- A requester can never start a budget document that cannot be submitted because the year is
  unprepared, and is told why, in Lao, before filling the form.
- After the year turns, no new document charges last year's budget, except where the money was
  already reserved by a predecessor.
- "Today" means the company's day everywhere this change touches.
- Admins hear about it a month ahead, from the system rather than from memory.

**Non-Goals:**
- Automatic creation of the next fiscal year, its budgets, or its quota entitlements. Each is a
  business decision, and the readiness view makes the gap visible instead.
- Budget carry-forward or lapse policy for unused 2026 money. The `accounting-period` spec already
  defers it on purpose.
- Changing how 2026 documents already in approval reserve, convert or release. They keep their
  2026 budget.
- Quota-year semantics. Quota usage already resets by calendar year, and only readiness reporting
  is added.

## Decisions

**D1. The guard lives in `DocumentService.create`, before the number is issued.**
- **Why there:** a refused create must not burn a `doc_running_number` value. A gap in numbering is
  a finding in an audit.
- **The check:**
  - `today = localDateIn(now, company.timezone)`;
  - find the company's `fiscal_year` with `status = OPEN` and `start_date <= today <= end_date`;
  - then `count(budget where fiscal_year = it and status = ACTIVE) > 0`.
- **The refusals:** `explained('fiscalYear.noOpenYear', { year })` or
  `explained('fiscalYear.noActiveBudget', { year })`, where `year` is the calendar year of `today`
  when no row covers it.
- **Exemption:** `createFrom` — the one path that builds a successor from an approved predecessor,
  used by the user's "create from" and by the `CREATE_SUCCESSOR` sweeper alike — passes an explicit
  `{ asSuccessor: true }` to `createDraft`. It is never inferred from a client field such as
  `refDocumentId`, so a client cannot opt out.
- **Shared helper:** the check is `FiscalYearService.assertBudgetedOpenYear(companyId, today)`, so
  creatable-types (D2) and readiness (D5) use the same query.
- *Alternative considered:* refusing at submit only, as today. The user rejected it, because the
  requester has already done the work by then.

**D2. Creatable-types carries the block, not a separate endpoint.**
- Each `requires_budget` type gets `blocked?: { key, year }` when D1's check fails. The check is
  computed once per request, not once per type.
- The wizard already loads this list, so no new request is needed. Disabled cards reuse the existing
  card component's disabled state.
- *Alternative considered:* a separate `/fiscal-years/current-status` call. It is one more request,
  and the two could disagree.

**D3. The year scope is applied in `listSelectable`, and inheritance comes from the document.**
- Add `fiscalYear: currentOpenYearId` to the `where`.
- With `documentId`, union the budgets on that document's lines that are marked inherited. The
  inherited marker already exists from the "successor keeps inherited budgets" work; reuse its
  predicate rather than inventing one.
- Submit gets the matching check (spec: "Submit Refuses a Line Charging Another Year's Budget"),
  placed with the existing ACTIVE-budget re-check in `document-submit.service.ts`, before
  reservation.
- **Sequence for budget writes:** the new check is read-only and runs inside the existing submit
  `em.transactional`, before the `PESSIMISTIC_WRITE` budget lock and the RESERVE insert. No new
  `budget_txn` or `quota_usage` writes are introduced, and the transaction boundary and lock order
  are unchanged.

**D4. A company-local "today" in numbering and submit.**
- Replace `getUTCFullYear()` and the ISO `slice(0,10)` with `localDateIn(new Date(), company.timezone)`.
  The year is the first four characters.
- Applies to `DocumentService.create`, `document-submit.service.ts` (`asOf`), and the numbering in
  `budget-adjustment.service.ts`, `budget-transfer.service.ts` and `budget-plan.service.ts`.
- The numbering service itself is unchanged. It still takes a `year`, and locking stays
  `PESSIMISTIC_WRITE` on `doc_running_number`.
- *Risk:* the existing concurrency tests use the UTC year. They must stay green, and a test pinned
  to `2026-12-31T20:00Z` with an `Asia/Vientiane` company asserts 2027.

**D5. Readiness read: `GET /fiscal-years/readiness`.**
- A single service method, `FiscalYearReadinessService.read(companyId, today)`, makes only counts:
  - the current fiscal year;
  - the next fiscal year (`start_date = current.end_date + 1 day`);
  - the next year's ACTIVE budgets (count);
  - the missing entitlements: current-year `quota_entitlement` pairs anti-joined against next-year
    pairs, for quotas with `reset_cycle <> 'NONE'`;
  - a `BUDGET_RATE` row in the next year's date range (exists).
- **Authorization:** any one of three codes. If the RBAC guard has no any-of form, add one, because
  stacking three guards would mean "all of". Verify the guard's semantics first.
- **Isolation:** company-scoped through the active-company filter.

**D6. A daily readiness sweep piggybacks on the scheduler pattern.**
- A new `FiscalYearReadinessScheduler` runs `@Interval(1h)`. For each active company, it computes
  `today` (company-local).
- **When it sends:** inside the window (`today >= end_date - 30 days`) and `!ready`, or past an
  unprepared turn (D1's check fails).
- **Who receives it:** users holding any of the three codes in that company.
- **Once a day:** each send is idempotent per (company, user, local date): before dispatching, the
  sweep looks for a notification to that user with the same title created since the company's
  local midnight. `notification` has no dedupe column, and none is added.
- **Content:** a literal Lao title (`ກຽມປີງົບປະມານ <year>`) and a message naming each missing item.
  `NotificationService.dispatch` already accepts template-less notices, so no template is seeded.
- *Alternative considered:* a `@Cron` at a fixed hour. Companies have different timezones, so an
  hourly interval with per-company local-day dedupe is simpler and correct.

**D7. The fiscal-year Close button is unchanged.** By the user's decision it stays, with its existing
confirmation; admins close the year themselves. If HAL declares no accounting periods, removing it
would leave no way to close a year at all. Because D3 already scopes budgets to today's year, a
year left open (or closed late) no longer lets new documents charge it.

**D8. Overlap check on create and update.**
- In `FiscalYearService.create` and `update`: `exists(fiscal_year where company = c and id <> self
  and start_date <= new.end and end_date >= new.start)`.
- The result is `explained('fiscalYear.overlap', { year })`.
- Also refuse `end_date <= start_date`.

**D9. Front-end.**
- **Wizard type step:** render a disabled card plus a `<Message severity="warn">` with
  `t('errors.fiscalYear.noOpenYear', { year })`. The same key handles a server refusal of
  `create`, through the existing `messageOf` mapping.
- **`FiscalYearsView`:** remove Close, add a link to the period close, and add a readiness panel.
- **Shell banner:** shown when the user holds any of the three codes. It reads readiness once per
  session and can be dismissed for the day; the dismissal is kept in `localStorage` (a per-viewer
  convenience, wrapped in try/catch).
- **Strings:** Lao, English and Chinese.
- **Styling:** PrimeUI tokens only, PrimeIcons `pi pi-calendar-times`.

## Risks / Trade-offs

- **[A December draft becomes unsubmittable in January unless re-pointed]** → This is intended by
  the user's rule. The submit error names the line and year, the picker offers the 2027 budget of
  the same code, and the year-end checklist tells requesters to submit before 31 Dec.
- **[A successor flag could be abused to skip the guard]** → It is a server-internal parameter on
  the service call made by the successor outbox. No DTO field maps to it.
- **[The company timezone is wrong in prod]** → It defaults to `Asia/Bangkok` (UTC+7, the same
  offset as Vientiane). Confirm HAL's value before deploy (see Open Questions). A wrong zone shifts
  the boundary by hours, not years.
- **[The readiness query is slow on large entitlement tables]** → It runs once a day per company
  and per page view, and the unique index on `(quota_id, employee_id, year)` serves the anti-join.
- **[Pressing Close mid-year blocks budget submits for the rest of that year, and the page cannot
  reopen it]** → The existing confirmation stays; the year-end checklist says to press it only after
  the year has ended. Pressed after the year ends it is harmless: the closed-year check runs only at
  submit, against today's date, and approvals and payments of documents still pending from that
  year never consult the fiscal year's status.
- **[Spam]** → Dedupe is per local day, and the sweep stops at `ready`.

## Migration Plan

1. **Deploy.** No schema migration and no seed step are needed.
2. **Verify on the trial host.** Create fiscal year 2027 with no budgets and fake the clock in tests.
   Check that:
   - budget types are blocked;
   - leave still works;
   - readiness lists the gaps.
3. **Before 1 Dec 2026, HAL admins act.** They hold the permission codes and will be warned from
   1 Dec, because 2026's `end_date` is 31 Dec.
4. **Rollback.** Revert the commit. There is no data to undo: the only new writes are notification
   rows and the template.

## Open Questions

- What is the HAL company's `timezone` value in production? It is read-only to confirm: the user
  runs a `SELECT code, timezone FROM company;`.
- Should a budget-plan document for the *next* year be raisable before that year starts? It
  already is, because plan types have `requires_budget = false`. This is confirmed, not changed.

## 1. Groundwork

- [x] 1.1 Confirm no schema change is needed (fiscal_year, budget, quota_entitlement, exchange_rate, company.timezone all exist); confirm the "inherited budget" predicate from the successor-keeps-inherited-budgets work and note its location
- [x] 1.2 Check the RBAC permission guard's semantics for multiple codes; if it means "all of", add an any-of decorator/guard with a unit test
- [x] 1.3 Add error keys `fiscalYear.noOpenYear`, `fiscalYear.noActiveBudget`, `fiscalYear.lineWrongYear`, `fiscalYear.overlap` to the backend explained-error catalogue and to `front-end/src/i18n/locales/{la,en,zh}/errors.ts`
- [x] 1.4 ~~Seed a notification template~~ — not needed: the sweep dispatches a literal Lao title/message (dispatch already supports template-less notices), so nothing is seeded

## 2. Company-local "today"

- [x] 2.1 Add `FiscalYearService.todayFor(companyId)` (or reuse) built on `localDateIn(new Date(), company.timezone)`
- [x] 2.2 Replace `getUTCFullYear()` in `DocumentService.create` and in budget adjustment / transfer / plan numbering with the company-local year
- [x] 2.3 Replace the UTC `asOf` in `document-submit.service.ts` with the company-local date
- [x] 2.4 Test: a company in `Asia/Vientiane` creating at `2026-12-31T20:00Z` gets a 2027 number and the 2027 `doc_running_number` row; existing numbering concurrency tests stay green

## 3. Creation guard

- [x] 3.1 Add `FiscalYearService.assertBudgetedOpenYear(companyId, today)` returning/throwing the two explained errors
- [x] 3.2 Call it in `DocumentService.create` for `requires_budget` types, before `numbering.next`; add the server-internal `origin: 'successor'` exemption used only by the successor creation path
- [x] 3.3 Tests: refused without a covering open year (no counter advance); refused with a year but no ACTIVE budget; non-budget type created; budget-plan type created; successor created and keeps the inherited budget
- [x] 3.4 Extend creatable-types to return `blocked: { key, year }` on `requires_budget` types when the guard fails (one check per request); test both blocked and unblocked

## 4. Year-scoped budgets

- [x] 4.1 Scope `BudgetService.listSelectable` to the open fiscal year covering today; with `documentId`, include that document's inherited budgets; empty when no open year
- [x] 4.2 In submit, refuse a line whose budget's fiscal year is not the open year covering the submit date unless inherited — inside the existing transaction, before the budget lock and RESERVE insert
- [x] 4.3 Tests: 2026 `6.101` hidden and 2027 `6.101` shown on 2027-01-05; inherited 2026 budget shown for its successor; December draft with 2026 line refused at January submit with no `budget_txn` written; re-pointed draft reserves against 2027

## 5. Fiscal year administration

- [x] 5.1 Overlap + `end_date > start_date` validation in `FiscalYearService.create` and `update`; tests for overlap refused and adjacent accepted

## 6. Readiness read and sweep

- [x] 6.1 `FiscalYearReadinessService.read(companyId, today)` — current year, days left, next year existence/status, next-year ACTIVE budget count, missing entitlement pairs (reset_cycle ≠ NONE), BUDGET_RATE presence, `ready`
- [x] 6.2 `GET /fiscal-years/readiness` guarded by any of `FISCAL_YEAR_MANAGE` / `BUDGET_MANAGE` / `QUOTA_MANAGE`, company-scoped; controller test incl. 403 and cross-company isolation
- [x] 6.3 `FiscalYearReadinessScheduler` (`@Interval` hourly): per active company, notify holders of the three codes inside the 30-day window or after an unprepared turn, deduped per (company, user, local date); register in the module
- [x] 6.4 Scheduler tests with an injected clock: 2026-11-30 none; 2026-12-01 one per holder; repeated runs same day still one; stops when ready; 2027-01-02 unprepared sends the "blocked" wording; `DOC_CREATE`-only user gets none

## 7. Front-end

- [x] 7.1 Extend the creatable-type API type with `blocked?: { key: string; year: number }`
- [x] 7.2 Wizard type step: blocked cards disabled (pointer + keyboard, `aria-disabled`), warn `Message` with the translated reason; a server year-block refusal on create shows the same message
- [x] 7.3 `FiscalYearsView`: keep the Close button unchanged; show the overlap error message
- [x] 7.4 Readiness panel on the fiscal-years page (done/missing per item, links to budgets / quota-admin / currency-admin, days left), gated by the three codes
- [x] 7.5 Shell banner for holders of the three codes inside the window or after an unprepared turn; dismissible for the day via try/catch-wrapped `localStorage`; PrimeUI tokens, `pi pi-calendar-times`
- [x] 7.6 Lao / English / Chinese strings for all new UI
- [x] 7.7 Component tests: blocked card disabled + message; non-budget card selectable; Close button still offered (unchanged code, covered by the existing view); readiness panel renders gaps; banner shown/hidden by permission and readiness

## 7b. Budget list year filter (added during apply, at the user's request)

- [x] 7b.1 `BudgetListQueryDto.fiscalYearId` narrows `BudgetService.list` inside company scope; `GET /budgets/filter-fiscal-years` (`BUDGET_VIEW`) returns the years and the default (year covering today, company-local, else most recent open)
- [x] 7b.2 Budget list: year `Select` in every mode, default from the server, drives list + control points + tree; clearable to all years; Lao/English/Chinese strings
- [x] 7b.3 Tests: backend list narrows by year and lists all without one; front-end opens on the default year, switches from page 1, clears to all, survives a failed options read

## 8. Verification

- [x] 8.1 Run backend suite against the test DB (`DB_PORT=5433 DB_NAME=erp_test`), frontend suite, both builds and typechecks
- [x] 8.2 Update `docs/learning/year-end-checklist.md` to reflect the new guard and readiness page
- [ ] 8.3 Ask the user to confirm HAL's `company.timezone` on prod with a read-only `SELECT code, timezone FROM company;` before deploying

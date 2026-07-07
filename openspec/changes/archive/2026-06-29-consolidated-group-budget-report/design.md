## Context

Building blocks confirmed by audit:
- `CompanyScopeService.forGroupRead()` returns a fork with NO company filter bound; callers pass
  `{ filters: { company: false } }` and treat the result as read-only.
- `Company` (not company-scoped) has `baseCurrency` (nullable), `code`, `nameTh/nameEn`, `isActive`.
- `BudgetBalanceService.breakdown(budgetId)` derives a budget's balance from `budget_txn` and is
  scoped to the active company via `RequestContext.companyId()` (through `fiscalYear.company`). Slice A's
  `ReportingService.budgetBalanceByDeptCategory()` already aggregates these per company.
- `ExchangeRateService.convert({ from, to, asOf, rateType?, companyId?, amount })` →
  `{ baseAmount, rate, source }`. With **no `companyId`**, `resolveRate` goes straight to the GROUP
  rate (company=null), then inverse fallback, else throws.
- `ScopeService.scopeFor(code)/isGroup(code)` read the active grants; `PermissionsGuard` checks only
  that a code is present (not its scope). `RequestContext.run(store, cb)` is AsyncLocalStorage-based
  and nestable.

## Goals / Non-Goals

**Goals:**
- One read-only `GET /reports/group/budget-balance?currency=<CCY>&asOf=<date?>` that aggregates every
  active company's budget balances and converts them into the caller-chosen presentation currency at
  the GROUP rate as of the report date, returning per-company rows + a group total.
- Gate it on a new `REPORT_GROUP_VIEW` granted at GROUP scope; enforce GROUP scope in the service
  before any cross-company read.
- Keep the numeric derivation identical to Slice A (single source of truth) and keep conversion
  strictly presentation-only.

**Non-Goals:**
- No consolidated versions of the other reports (aging/quota/audit) — explicitly out of this slice.
- No new rate type (uses the existing default/GROUP rate hierarchy as of the date); no group-base-
  currency config (currency is a per-request parameter).
- No writes of any kind; no change to `budget.amount_total`, no document FX recompute (invariant 6).
- No caching/materialization; computed fresh per request.

## Decisions

1. **GROUP-scope is enforced in the service, not just the guard.** `@RequirePermissions
   (REPORT_GROUP_VIEW)` ensures the caller holds the code, but the guard is scope-blind. So
   `GroupReportingService` first calls `scope.isGroup('REPORT_GROUP_VIEW')` and throws `Forbidden`
   if the code is held at a narrower scope. Only then does it switch to `forGroupRead()`. This is the
   one place company isolation is widened, and it is widened deliberately and read-only.

2. **Reuse the Slice-A per-company derivation via a nested `RequestContext.run`.** For each active
   company, the service runs the existing company-scoped budget aggregation inside
   `RequestContext.run({ userId, grants, companyId: <thatCompany> }, …)`, preserving the caller's
   identity but rebinding the active company. This reuses `breakdown()`'s exact derived-balance math
   per company — no duplicated ledger formula — so the group report and each company's own report
   always agree. (The company list itself comes from a single `forGroupRead()` query.)

3. **Convert per company, at the GROUP rate as of the report date, with no `companyId`.** Each
   company's aggregated totals (in its own base currency) are converted to the presentation currency
   by `ExchangeRateService.convert({ from: companyBase, to: currency, asOf, amount })` — omitting
   `companyId` so the GROUP rate (company=null) is used, with inverse fallback. `asOf` defaults to
   today. The resolved rate and its `source` are returned per company for transparency. Amounts are
   rounded to the presentation currency's `decimal_places` by `convert` itself.

4. **A company with no resolvable rate is reported, not fatal.** If `convert` throws "no rate" for a
   company's base→presentation pair, that company is marked `convertible: false`, its native-currency
   total is still shown, and it is **excluded from the group total** (which is only meaningful in the
   one presentation currency). The report never fails wholesale because one pair lacks a rate — but it
   never silently drops the company either. A company whose `baseCurrency` is the presentation
   currency converts at rate 1 (IDENTITY).

5. **Response shape.** `{ currency, asOf, companies: [{ companyId, companyCode, companyName,
   baseCurrency, rate, rateSource, convertible, nativeTotal, convertedTotal, groups: [...] }],
   groupTotal: { amountTotal, reserved, actual, released, available } }` — per-company group-level
   subtotals (by department/category, as Slice A) plus a presentation-currency group total summed
   over convertible companies.

6. **`REPORT_GROUP_VIEW` is distinct from `REPORT_VIEW`.** Holding company `REPORT_VIEW` grants the
   four company reports only; the group report needs the separate code at GROUP scope. The seed grants
   `REPORT_GROUP_VIEW` (GROUP) to the group-admin/exec role so the demo can exercise it.

## Risks / Trade-offs

- **Cross-company read is a deliberate isolation exception.** It is confined to this read-only report,
  guarded by a GROUP-scope-only permission, and enforced in the service. Documented as an intentional
  widening, not a leak — the guard-plus-service check is the safety boundary.
- **Rate availability.** Consolidation quality depends on GROUP rates existing for each company
  base→presentation pair as of the date. The per-company `convertible` flag + the rate `source`
  ("GROUP"/"INVERSE"/"IDENTITY") make gaps visible rather than hiding them; unconvertible companies
  are excluded from the total with their native figure still shown.
- **N+1 across companies × budgets.** Same shape as Slice A, one level out. Fine at realistic company
  counts; a SQL-side fold is a later optimization, explicitly out of scope and noted (not "covered").
- **Presentation vs accounting.** These converted figures are an advisory management view at a current
  rate — they are NOT booked, NOT the locked document FX, and NOT an FX gain/loss. That separation is
  the whole point of invariant 6 and is preserved.

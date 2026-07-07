## 1. Permission + module wiring

- [x] 1.1 Add `REPORT_GROUP_VIEW` to `reporting/permissions.ts`; it is registered via the seed's
      `allPermissionCodes()` enumeration (ReportingPermissions already in the set).
- [x] 1.2 Seed: grant `REPORT_GROUP_VIEW` at **GROUP** scope to the group-admin/exec role (so the demo
      can exercise the report); leave the company admin's `REPORT_VIEW` unchanged.
- [x] 1.3 `ReportingModule` imports `MultiCurrencyModule` (ExchangeRateService) and provides
      `ScopeService` (from RbacModule export or as a provider) + the new `GroupReportingService`.

## 2. Group reporting service

- [x] 2.1 `GroupReportingService.consolidatedBudgetBalance({ currency, asOf? })`:
      - assert `scope.isGroup('REPORT_GROUP_VIEW')` → else `ForbiddenException`;
      - list active companies via `CompanyScopeService.forGroupRead()` (`{ filters: { company: false } }`),
        populating `baseCurrency`;
      - for each company, compute its budget balances by reusing the Slice-A company derivation inside
        `RequestContext.run({ userId, grants, companyId }, …)` (no duplicated ledger math);
      - default `asOf` to today.
- [x] 2.2 Convert each company's totals to `currency` via `ExchangeRateService.convert({ from:
      companyBase, to: currency, asOf, amount })` with **no `companyId`** (GROUP rate, inverse
      fallback). Same-currency → rate 1 (IDENTITY, no lookup). Capture rate + source per company.
- [x] 2.3 On "no rate" for a company, mark it `convertible: false`, keep its native total, exclude it
      from the group total (never throw for the whole report).
- [x] 2.4 Build the response: per-company rows (companyId/code/name, baseCurrency, rate, rateSource,
      convertible, nativeTotal, convertedTotal, dept/category groups) + `groupTotal` summed over
      convertible companies in the presentation currency.

## 3. Endpoint

- [x] 3.1 `GET /reports/group/budget-balance` with `GroupBudgetBalanceQueryDto` (`currency` required,
      `asOf?` ISO date), guarded by `@RequirePermissions(REPORT_GROUP_VIEW)`.

## 4. Backend tests

- [x] 4.1 Two companies with different base currencies + a GROUP rate for each base→presentation pair:
      assert per-company converted totals and the group total reconcile; reserved/available reflect the
      derived formula per company.
- [x] 4.2 Authorization: a caller with `REPORT_GROUP_VIEW` NOT at GROUP scope (and one with only
      company `REPORT_VIEW`) is refused; a GROUP-scope caller succeeds.
- [x] 4.3 Missing-rate company is reported `convertible: false` with its native total and excluded from
      the group total, while a same-currency company is included at rate 1 — the report still returns.
- [x] 4.4 Presentation-only: the report writes no `budget_txn` row and does not change any
      `budget.amount_total` (count rows before/after).

## 5. Frontend

- [x] 5.1 `api/reports.ts`: `groupBudgetBalance({ currency, asOf? })`; store action `loadGroupBudgetBalance`.
- [x] 5.2 A Group consolidated view (presentation-currency picker from active currencies + as-of date),
      per-company table with native + converted totals + rate/source, and the group total; amounts
      formatted to each currency's `decimal_places`. Show an "unconvertible" tag for companies with no
      rate.
- [x] 5.3 Route + nav entry gated on `REPORT_GROUP_VIEW` (sits with the other reports).

## 6. Verification

- [x] 6.1 Backend: `nest build` clean; the new group tests pass; the full suite stays green.
- [x] 6.2 Frontend: `vue-tsc` clean; i18n labels (en + la) added for the group report; i18n parity passes.
- [x] 6.3 Confirm invariants: cross-company read happens ONLY under verified GROUP scope; no writes; no
      locked-FX recompute; balances derived. (Note the cross-company N+1 as a documented future
      optimization, not a defect.)

> **Audit bar (per view):** R=renders without error · L=loading state · E=empty state
> (EmptyState with `title`+`message`) · X=error state + retry · $=money via `decimal_places`
> · P=permission gating · I=i18n keys resolve. Record findings inline per task.
>
> **Result:** all 31 routed views render; 2 bug classes found & fixed (report EmptyState
> missing `title`; SelectCompanyView no error/empty handling). Suite 164 → **202 tests**,
> `vue-tsc -b` clean, prod build OK. See "Audit results" at the bottom.

## 1. Gate & known-bug fixes

- [x] 1.1 Fix the 7 `vue-tsc` errors: `:message` → `:title` on `<EmptyState>` in `reports/ApprovalAgingReport.vue` (×3), `BudgetAuditReport`, `BudgetBalanceReport`, `GroupBudgetReport`, `QuotaRemainingReport`
- [x] 1.2 Grepped all `<EmptyState>` usages — only the 7 report sites lacked `title`; every other view already passes `title`
- [x] 1.3 `npx vue-tsc -b` exits clean (0 errors)
- [x] 1.4 Added `typecheck` + `ci` scripts (`ci` = typecheck && test); `build` already chains `vue-tsc -b`. (No GH Actions repo CI exists — wiring it is infra, out of scope; logged as follow-up.)

## 2. Smoke-test harness

- [x] 2.1 `src/test/mountView.ts` — mounts a view with testing Pinia (stubbed actions resolve), memory router, i18n, PrimeVue + Toast/Confirmation, `can`/`styleclass` directives; `src/test/setup.ts` polyfills `matchMedia`/`ResizeObserver`
- [x] 2.2 Per-view smoke pattern established: `src/test/smoke/views.smoke.spec.ts` mounts every routed view and asserts it renders without throwing

## 3. Auth & shell pages

- [x] 3.1 `LoginView` — R,X(via `<Message>`),I ✓ smoke ✓
- [x] 3.2 `SelectCompanyView` — **FIX:** had `try/finally` with no `catch` (silent failed switch) and no empty state. Added error `<Message>` + empty message + i18n keys (en/la). R,L,E,X,I ✓ smoke + behavior tests ✓
- [x] 3.3 `CompanyFormView` — R,P,I; errors via `<Message>` ✓ (not router-mounted; opened from CompaniesView)
- [x] 3.4 `DashboardView` — R,E,I; widgets self-gate by permission ✓ smoke ✓

## 4. Documents

- [x] 4.1 `documents/MyDocumentsView` — R,L,E,X,P,I ✓ smoke ✓
- [x] 4.2 `documents/CreateDocumentView` — R,X(`<Message>`),P,I; money via `Decimal` (no float) ✓ smoke ✓
- [x] 4.3 `documents/DocumentDetailView` — R,L,X,P,I ✓ smoke ✓

## 5. Approvals & payments

- [x] 5.1 `approvals/ApprovalInboxView` — R,L,E,X,I ✓ smoke ✓
- [x] 5.2 `payments/ReadyToPayView` — R,L,E,X,P,I ✓ smoke ✓

## 6. Budgets

- [x] 6.1 `budgets/BudgetListView` — R,L,E,X,P,I ✓ smoke ✓
- [x] 6.2 `budgets/BudgetDetailView` (+ `BudgetWaterfallChart`) — R,L,E,X,P,I ✓ smoke ✓
- [x] 6.3 `budgets/BudgetFormView` — R,L,X(`<Message>`),P; money via shared zod ✓ smoke ✓
- [x] 6.4 `budgets/BudgetTransferDialog` — R,X(`<Message>`),P; same-budget transfer rejected by schema ✓

## 7. Quota

- [x] 7.1 `quota/QuotaListView` — R,L,E,X,I ✓ smoke ✓
- [x] 7.2 `quota/QuotaDetailView` — R,L,E,X,I ✓ smoke ✓

## 8. Reports

- [x] 8.1 `reports/ReportsView` — R,I ✓ smoke ✓
- [x] 8.2 `reports/GroupBudgetReport` — R,L,E(fixed),X,I ✓ smoke + empty-state regression ✓
- [x] 8.3 `reports/BudgetBalanceReport` — R,L,E(fixed),X,I ✓ smoke + regression ✓
- [x] 8.4 `reports/BudgetAuditReport` — R,L,E(fixed),X,I ✓ smoke + regression ✓
- [x] 8.5 `reports/ApprovalAgingReport` — R,L,E(fixed ×3),X,I ✓ smoke + regression ✓
- [x] 8.6 `reports/QuotaRemainingReport` — R,L,E(fixed),X,I ✓ smoke + regression ✓

## 9. Notifications & master data

- [x] 9.1 `notifications/NotificationInboxView` — R,L,E,X,I ✓ smoke ✓
- [x] 9.2 `master/MasterDataView` — R,L,E,X,P,I ✓ smoke ✓

## 10. Admin

- [x] 10.1 `admin/DocConfigView` — R,L,E,X,P,I ✓ smoke ✓
- [x] 10.2 `admin/ApprovalConfigView` — R,L,E,X,P,I ✓ smoke ✓
- [x] 10.3 `admin/RbacAdminView` — R,L,E,X,P,I ✓ smoke ✓
- [x] 10.4 `admin/CurrencyAdminView` — R,L,E,X,P,I ✓ smoke ✓
- [x] 10.5 `admin/EmployeeAdminView` — R,L,E,X,P,I ✓ smoke ✓
- [x] 10.6 `admin/QuotaAdminView` — R,L,E,X,P,I ✓ smoke ✓

## 11. Org admin

- [x] 11.1 `admin/org/CompaniesView` — R,L,E,X,P,I ✓ smoke ✓
- [x] 11.2 `admin/org/DepartmentsView` — R,L,E,X,P,I ✓ smoke ✓
- [x] 11.3 `admin/org/FiscalYearsView` — R,L,E,X,P,I ✓ smoke ✓
- [x] 11.4 `admin/org/HolidaysView` — R,L,E,X,P,I ✓ smoke ✓

## 12. Cross-cutting checks

- [x] 12.1 Money audit: views display money via `formatAmount`/`Decimal`; the only `Number()` calls are on quantities/validation guards, never carrying or summing money. No float violation.
- [x] 12.2 i18n audit: existing `i18n.parity.spec.ts` (key parity en↔la) + `no-literal-text.spec.ts` pass; new `auth.selectCompany.error/empty` keys added to both locales.
- [x] 12.3 Permission audit: every protected route carries `meta.permission`; read-only list/report views rely on the route guard, action-bearing views use `v-can`/permission. Consistent with server scope.
- [x] 12.4 Walked every route via the smoke-mount suite (render proxy) + a clean prod `vite build`. A live browser click-through needs the running backend/auth and is out of this change's automation; smoke + build is the substitute.

## 13. Wrap-up

- [x] 13.1 Triaged findings: 2 bug classes fixed in-scope. Follow-ups (perf/infra, not correctness): main bundle >500 kB (code-split), `[INEFFECTIVE_DYNAMIC_IMPORT]` router warning, repo CI workflow.
- [x] 13.2 `vue-tsc -b` clean; full Vitest suite green — **202 tests** (was 164; +38: 31 view smoke, 5 report empty-state, 2 select-company).
- [x] 13.3 Audit results summarized below.

---

## Audit results

**Scope walked:** 31 routed views + 4 embedded report sub-views + `CompanyFormView`.

**Bugs found & fixed (2 classes):**
1. **Report empty states rendered a blank title** — 6 report views passed `:message` to
   `<EmptyState>`, whose `title` prop is required (`vue-tsc` flagged 7 sites). Empty report
   tables showed a heading-less block. Fixed by passing the existing string as `:title`.
   Guarded by `report-empty-state.spec.ts`.
2. **`SelectCompanyView` swallowed switch failures** — `choose()` had `try/finally` with no
   `catch`, so a failed company switch gave no feedback; an account with no companies showed
   a blank list. Added an error `<Message>`, an empty-state message, and `en`/`la` i18n keys.
   Guarded by `select-company.spec.ts`.

**No issues found in:** money formatting (Decimal/`formatAmount` throughout), permission
gating (route `meta` + `v-can`), i18n key resolution (parity tests green), and view
rendering (all 31 views mount cleanly).

**Follow-ups (out of scope — perf/infra, not correctness):** main JS chunk >500 kB
(code-splitting), `[INEFFECTIVE_DYNAMIC_IMPORT]` on `router/index.ts`, and adding a repo
CI workflow to run `pnpm run ci`.

**Standing guards added:** `vue-tsc -b` clean as a gate; smoke-render test for every routed
view; empty-state and select-company regression tests.

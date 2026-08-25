## 1. The read returns what it could be run for

No entity, no migration, no DTO change: `BudgetBalanceQueryDto` already validates `fiscalYearId`
and `departmentId` as UUIDs, and `reporting.controller.ts` already forwards both to `byQuarter`.

- [x] 1.1 In `back/src/modules/reporting/budget-quarter.service.ts`, extend `BudgetQuarterReport`
      with `fiscalYears: FiscalYearRef[]` and `departmentOptions: DepartmentOption[]`. Name the
      department list APART from the existing `departments`, which carries the rows and legitimately
      holds one under a filter.
- [x] 1.2 Resolve both lists BEFORE the filters narrow anything, each as its own small query — the
      company's `fiscal_year` rows ordered by year, and the distinct `department` of the target
      year's `budget` rows ordered by name. Do NOT derive either from the `budgets` already loaded:
      that query carries `where.department` under a filter and would collapse the picker to the one
      department already chosen.
- [x] 1.3 Return both lists on the early exit taken when the year holds no budgets, so a year with
      nothing in it still offers the years that do.
- [x] 1.4 Confirm the ledger is still read exactly once: the two lists must not touch `budget_txn`.

## 2. Backend tests

- [x] 2.1 In `back/src/modules/reporting/budget-quarter.spec.ts`, pin that both lists survive a
      `departmentId` filter — rows for one department, every department still listed.
- [x] 2.2 Pin that `fiscalYears` holds every year of the company when the read runs for a named one.
- [x] 2.3 Pin that `departmentOptions` describes the year being reported, not another year's.
- [x] 2.4 Pin company scope (invariant 1): neither list contains another company's fiscal year or
      department.
- [x] 2.5 Update the existing query-count test from `reads === 3` to `reads === 5` and keep its
      purpose — assert the two new reads are the year list and the department list, and that
      nothing is issued per quarter, per month or per filter. Add the filtered case, which must
      also be 5.
- [x] 2.6 Pin that the lists are returned when the fiscal year holds no budgets at all.

No concurrency test applies: this change writes nothing. No `em.transactional()` boundary and no
`LockMode.PESSIMISTIC_WRITE` are introduced.

## 3. The pickers

- [x] 3.1 Mirror `fiscalYears` and `departmentOptions` in `front-end/src/api/reports.ts`, reusing
      the existing `FiscalYearRef`.
- [x] 3.2 In `front-end/src/views/reports/BudgetQuarterReport.vue`, add a fiscal-year `<Select>` and
      a department `<Select>` to `PageHeader`'s `#actions` slot, following
      `BudgetLedgerReconciliationView`: options from the response, `@change` re-runs
      `loadBudgetByQuarter({ fiscalYearId, departmentId })`.
- [x] 3.3 Seed the year selection from the response's `fiscalYearId` on first load, so the control
      shows the year actually being reported rather than an empty placeholder.
- [x] 3.4 Clear the department selection when the fiscal year changes, and re-run for the whole of
      the new year — a department is a property of that year's budgets and may hold none in it.
- [x] 3.5 Give the department control a way back to every department, so a reader who filtered can
      undo it without reloading the page.

## 4. The in-page narrowings

- [x] 4.1 Add a search input over budget code and name. It must NOT re-run the read: the response
      already answers it, and a round-trip would open a window where the tiles and the table
      disagree.
- [x] 4.2 Keep a department when any line beneath it matches; keep every line of a department whose
      own name matches. A search for `1.101` that dropped the department would drop the row it was
      meant to find.
- [x] 4.3 Add an overspent-only toggle over the loaded rows, on the same terms.
- [x] 4.4 Recompute the summary tiles from the rows actually shown. They sum every department in
      the response today, which would contradict the table directly beneath them once narrowed.
- [x] 4.5 Distinguish the two emptinesses: a fiscal year holding no budgets, and a narrowing that
      matched nothing. Different messages, and the second names the control to undo.
- [x] 4.6 Add every new label to `front-end/src/i18n/locales/{en,la,zh}/reports.ts` in the same
      task. Insert each into the `budgetQuarter` block specifically — the `budgetBalance` block
      carries identical strings, and a key placed in the wrong one resolves through the English
      fallback on a Lao page. `i18n.parity.spec.ts` catches a missing key; it cannot catch a
      misplaced one.

## 5. Frontend tests

- [x] 5.1 In `front-end/src/views/reports/BudgetQuarterReport.spec.ts`, pin that choosing a
      department re-runs the read with that id, and that choosing a year re-runs it and clears the
      department.
- [x] 5.2 Pin that both pickers still offer every option after a filter is applied — the failure
      this change exists to prevent.
- [x] 5.3 Pin that the search narrows in place and issues NO request, and that it keeps the
      department of a matching line.
- [x] 5.4 Pin the overspent-only toggle, and that the tiles describe the rows shown rather than the
      rows removed.
- [x] 5.5 Pin the two empty messages apart.
- [x] 5.6 Assert the header renders in Lao, not through the English fallback — the guard against
      the misplaced-key mistake this screen has already made once.

## 6. Verify

- [x] 6.1 Drive the screen against the imported 2026 data: filter to `ພະແນກ ບໍລິຫານ`, confirm the
      department picker still offers all twenty, then search `1.101` and confirm the line appears
      under its department.
- [x] 6.2 Confirm the tiles change with the narrowing and never disagree with the table beneath.
- [x] 6.3 Run both suites, the frontend typecheck and the backend lint on the touched files before
      handing over.

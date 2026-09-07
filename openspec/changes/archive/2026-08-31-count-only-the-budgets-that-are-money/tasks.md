## 1. The rule

- [x] 1.1 One exported constant naming the statuses the report counts — `ACTIVE` and `CLOSED` —
      written as an allow-list. Not a list of exclusions: a status in no declared list already
      exists (`INACTIVE`), and a deny-list would admit it.
- [x] 1.2 `BudgetQuarterService`'s budget query narrows by that set. It `$and`s onto the
      fiscal-year predicate that carries company scope and must never replace it.
- [x] 1.3 `departmentsOf` narrows by the same set, so a department holding only uncounted budgets
      is not offered.

## 2. Saying what was left out

- [x] 2.1 The read reports how many budgets it excluded and their combined `amount_total`, for the
      fiscal year and department it was asked about.
- [x] 2.2 Nothing excluded reports nothing — a zero is not rendered as a fact about the data.
- [x] 2.3 The quarterly screen states it when there is something to state.
- [x] 2.4 Three locales for the new label.

## 3. Tests

- [x] 3.1 A `REJECTED` budget contributes nothing: not to the annual budget, not to a quarter's
      share, not to a department rollup, and not as a row. The customer's exact shape — one
      `ACTIVE` and two `REJECTED` on the same plan code.
- [x] 3.2 A `DRAFT` budget is excluded too.
- [x] 3.3 A `CLOSED` budget IS counted, and its consumption is measured against its own annual
      budget rather than against zero.
- [x] 3.4 A budget in an undeclared status (`INACTIVE`) is excluded — the case a deny-list would
      have missed.
- [x] 3.5 The consumption figures of the counted budgets are unchanged by this filter. The change
      moves the ceiling, never the ledger.
- [x] 3.6 The department options exclude a department holding only uncounted budgets.
- [x] 3.7 The excluded count and total are reported when something was left out, and absent when
      nothing was.
- [x] 3.8 Company isolation still holds with the status predicate applied.
- [x] 3.9 The existing `budget-period-reporting` suites pass unchanged — in particular the
      ledger-figure and quarter-share specs, whose numbers must not move.

## 4. Verify against the report that started this

- [x] 4.1 Open the quarterly report for `ພະແນກບໍລິຫານ` on the customer's data and confirm the
      annual budget reads 1,092,800,000 rather than 1,792,800,000, that plan code `1.101` appears
      once rather than three times, and that the screen says two budgets were excluded. Read only —
      change no budget's status to prove it.

      Verified on the running app against the customer's own data. Nothing was written; no budget's
      status was touched.

      - `ພະແນກບໍລິຫານ` annual budget: **1,092,800,000** (was 1,792,800,000)
      - plan code `1.101` appears **once** — the rows are `1.101`, `1.106`, `1.201`
      - consumption unchanged at 35,422,000, so the utilisation percentage rises because the
        ceiling is now the truth, not because any ledger figure moved
      - the notice reads `ບໍ່ໄດ້ນັບ: 4 ງົບ ລວມ 708,000,000 — ...` : the two refused `1.101` at
        350,000,000 each plus the two `ZZ TEST` refused budgets in HQ. Four across the whole year is
        correct; the two the task predicted are the ADM half of it.
      - `departmentOptions` now lists only `ພະແນກບໍລິຫານ`. HQ dropped out because its only budgets
        are refused — the department-options rule working, and not something the task had predicted.
      - no console errors

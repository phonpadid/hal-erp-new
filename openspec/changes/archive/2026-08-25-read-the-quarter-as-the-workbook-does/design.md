## Context

`BudgetQuarterService.byQuarter()` already makes ONE pass over every `budget_txn` row of every
budget in the fiscal year, buckets each row into a quarter through `attributeQuarters()`, and rolls
budgets up into departments. It returns four `QuarterFigure`s per row plus a year utilization
percentage.

The customer's `ສາລະບານງົບປະມານ` sheet lays the same year out with more columns: for each plan line
it carries twelve monthly cells (`J K L | O P Q | S T U | W X Y`), a quarter total after each triple
(`M R V Z`), the year consumed (`AA`), what is left (`AB`), each quarter's share of the annual
budget (`AC AD AE AF`), the year's share (`AG`) and the remaining share (`AH`). The report already
computes `AA` (as the sum of the four quarters) and `AG` (as `yearUtilizationPct`). Everything else
is new.

Two constraints shape the work. This report runs over every document the company will ever raise —
it read 5,689 document lines and 2,374 ledger rows for 2026 alone — so the monthly split must come
out of the pass that is already happening. And the quarterly figures are the department's own
numbers: `M R V Z` on the sheet must equal the quarter totals on the screen, which means the twelve
monthly figures must sum to their quarter by construction, not by a second and separately-derived
calculation that can drift.

This is a read. It writes no `budget_txn` and no `quota_usage`, takes no lock, and opens no
transaction beyond the implicit read.

## Goals / Non-Goals

**Goals:**

- The three monthly figures inside each quarter, summing exactly to that quarter's consumption.
- Each quarter's share of the annual budget, under the rule already in force for the year's share:
  no share at all where the budget is zero.
- The year's consumed, remaining and remaining share on every row and every department.
- A quarter with nothing on either side labelled as never started, not as stopped.
- The screen readable at its default width, with the monthly detail available on demand.
- Departments and the budget lines beneath them derived from ONE rule each, never two.

**Non-Goals:**

- The workbook's `ໄຕມາດ` (annual ÷ 4) and `ສ່ວນຕ່າງ ໄຕມາດ` columns. Ruled out in the proposal; the
  quarter-against-quarter comparison remains the only comparison.
- A monthly comparison. Months are reported, not scored — the labelling problem the quarterly
  comparison solves is worse at monthly granularity, where most lines are empty.
- Reproducing the workbook's three under-counting departments. The sheet's group rows for
  departments 18, 19 and 20 sum their children instead of their own cells and so drop 929,934,363
  LAK booked directly onto group codes. The system reports what was spent.
- Any change to how budget is reserved, released, governed or carried forward.
- A new column on `budget_txn`. The ledger is append-only and stays as it is (invariant 2).

## Decisions

**Bucket months in the existing loop, keyed by `(budget, month)`.**
The loop over `attributable` already computes each row's quarter and its signed amount. It gains one
more `Map.set` into a `consumedByMonth` map keyed `${budgetId}:${month}`, where `month` is the
1-based month index WITHIN the fiscal year (1–12 from `fy.startDate`), derived the same way
`attributeQuarters` derives the quarter — from the window the row was attributed to, never from
`txnDate.getMonth()`. A fiscal year that does not start in January would otherwise put a row in a
month of the wrong quarter, which is the one thing this screen exists to state correctly.

_Alternative rejected:_ a second query grouping by `date_trunc('month', txn_date)`. It doubles the
scan of the heaviest read in the system, and it re-derives attribution — a `RELEASE` returned to the
quarter that committed it would land in its own month under SQL and in the reserve's month here, so
the twelve monthly figures would not sum to the four quarters.

**A month inherits its quarter's attribution.** A `RELEASE` is already attributed to the quarter of
the `RESERVE` it gives back. It SHALL likewise be attributed to the MONTH of that reserve. Any other
rule breaks the sum: three months whose signed amounts land outside their quarter cannot add up to
that quarter. This follows the existing rule rather than inventing a second one, and it carries the
same accepted cost, already recorded in the spec — a month already reported may move when a release
lands later.

**A monthly figure is a number, not a judgement.** No label, no percentage, no comparison. Months
exist here to show WHERE inside a quarter the money went; every question about direction is answered
by the quarter that contains them.

**Per-quarter share reuses `yearFigures`' rule, not a second one.** `quarterShare(amountTotal,
consumed)` is the same computation as the year's share against the same denominator — the ANNUAL
budget, which is what the workbook's `AC`–`AF` divide by, and which is the only budget figure that
exists (there is no per-quarter budget; that is exactly what the proposal declines to invent). Zero
budget yields `null`, never `0`. Extracting the shared rule into one function and calling it from
both places is the point: the last defect on this screen was two places computing one rule.

**`remaining` and `remainingPct` are derived, and `remainingPct` is only defined where a share is.**
`remaining = amountTotal − yearConsumed`, which may be negative and is left negative — that is
overspending, and the row is already flagged for it. `remainingPct = 100 − yearUtilizationPct` when
that is non-null, and `null` otherwise. `AH` on the sheet is `1 − AG`; where there is no `AG` there
is no `AH`.

**`compare()` gains one branch, ordered before `STOPPED`.** When both sides are zero the quarter
never ran, and the result is `NO_ACTIVITY` — a fifth member of `NoComparison`, not a reuse of
`NOT_STARTED`, which means something the reader can act on differently: `NOT_STARTED` says the
calendar has not arrived, `NO_ACTIVITY` says it has and nothing happened. Because `compare()` is the
single place the rule lives, departments and budget lines get the fix together.

**The monthly split is disclosed per quarter, not shown by default.** Four quarters × three months
plus four quarter totals plus four shares plus four year columns is 24 numeric columns; at the
customer's widths that is a horizontally-scrolling table nobody reads. The default view keeps
today's columns plus the quarter share and the four year columns, and each quarter header carries a
toggle that expands its three months in place. The toggle is per quarter because the department asks
"which month of Q2" — one quarter at a time.

_Alternative rejected:_ a single global "show months" switch. It produces the 24-column table on the
first click, which is the outcome the disclosure exists to avoid.

_Alternative rejected:_ a nested third tree level for months. `TreeTable` rows are departments and
budgets — entities. Months are columns of a row, not children of it, and putting them in the tree
makes "expand a department" mean two different things.

## Risks / Trade-offs

- **A `RELEASE` moves a month that was already read** → Same accepted cost as the quarter rule, and
  smaller in scope than the quarter it sits inside. Recorded in the spec so a moved figure is a
  known behaviour rather than a bug report.
- **The screen grows wide even with the months collapsed** → The default adds five columns (one
  share plus four year columns). The year columns go to the right of the quarters and the share sits
  UNDER its quarter total in the existing stacked cell rather than beside it, so the table gains one
  column band, not five.
- **`NO_ACTIVITY` reads as noise on a sheet where most lines are empty** → It replaces a wrong label,
  not a blank: those cells say `ຢຸດໃຊ້` today. It is rendered in the muted tone the other
  non-comparisons already use, so an unspent line recedes instead of shouting.
- **The screen will not match the workbook for departments 18, 19 and 20** → Stated in the proposal
  and traceable: the difference is 929,934,363 LAK booked directly onto group codes that the sheet's
  own `SUM(M…)` formulas skip. Named here so the first person to compare the two knows which is
  wrong.
- **Three languages drift** → Every new label goes into `en`, `la` and `zh` in the same task, as the
  existing keys did.

## Migration Plan

No migration. No schema change, no data change, no backfill. The read is additive — every field
today's clients consume keeps its name and meaning — so the backend can ship before the frontend.
Rollback is reverting the code.

## Open Questions

None. The workbook's rules for the added columns are arithmetic and verified against the file
(`AA = ΣM,R,V,Z`, `AB = I − AA`, `AC..AF = M,R,V,Z ÷ I`, `AG = AA ÷ I`, `AH = 1 − AG`), and the two
columns whose rule the customer's own sheets disagree about are the two this change does not add.

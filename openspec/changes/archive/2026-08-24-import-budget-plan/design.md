## Context

One sheet, `ສາລະບານງົບປະມານ`, of the monitoring workbook. Header on row 3; from row 4, one plan
line per row:

| col | | |
|---|---|---|
| 0 | a level marker | **unusable** — see below |
| 1 | `ລະຫັດ` | the plan code: `1`, `1.1`, `1.101` |
| 2 | `ລາຍການແຕ່ລະຂະແໜງ` | the line's name |
| 3, 4 | `ງົບປະມານ/2024`, `/2025` | prior years, populated on 21 rows |
| 5, 6, 7 | monthly, quarterly, ratio | derived columns |
| **8** | **`ງົບປະມານ/ປີ2026`** | **the annual figure this change imports** |
| 9+ | months 1–12, quarter usage, variance | actuals, not plan |

The level marker in column 0 looks like the depth the code cannot express, and is not: its values
1–6 map onto no consistent depth — level 3 appears on 7 department rows and 2 category rows, level
4 on 17 categories and 388 lines. Whatever it is, it is not the tree.

## Goals / Non-Goals

**Goals:**
- The customer's 2026 plan in the system, governed, with its own codes and names.
- Separate the plan's *structure* from its *money* without inventing either.
- Where the file contradicts itself, import what is certain and say precisely what was not.
- Create the 20 departments the plan is written against.

**Non-Goals:**
- Monthly and quarterly phasing. The file carries both; the system holds one annual figure per
  budget, as settled when `budget_node` was designed.
- The revenue plan (`ລາຍຮັບ` sheet), prior-year columns, and the actuals columns.
- The 5,715 spend rows. Next change; it needs the budgets this one creates — and it must import
  them per budget PER PERIOD, not as one opening document per budget. See
  `see-spending-by-quarter`, which was decided after this change was written and makes the earlier
  one-document-per-budget direction unusable.
- Reconciling the customer's spreadsheet for them. The report says where it disagrees with itself.

## Decisions

### Structure: department, then the longest existing shorter code

A plan code is `<department>.<tail>`. The part before the dot is always the department — `10` is
the tenth department, never a child of `1`. Within a department, a row's parent is the row whose
tail is the **longest proper prefix of this tail that exists in the plan**; failing that, the
department itself.

`1.101` → is there `1.10`? no → `1.1`? yes ✓. `1.111` → `1.11`? yes ✓.

*Alternative rejected — the prefix rule used for the chart of accounts, applied to the whole code.*
It reads `10` as a child of `1` and collapses 20 departments into 9. The account chart's codes
really do nest that way; these do not, and the difference is the dot.

*Alternative rejected — the level column.* Measured above: it disagrees with itself.

*Alternative rejected — treat a two-digit tail as a sibling of a one-digit tail.* Tried, measured:
11 of 20 departments reconcile, against 16 for the rule chosen. Neither is 20, which is the point
of the next decision.

### Money lives where the file puts money with nothing beneath it

Of the 313 rows carrying a 2026 amount:

- **241 have no amount anywhere beneath them.** These become `budget` rows — 410,702,798,507 LAK.
- **51 state exactly the sum of the money beneath them.** These are summaries. They become
  `budget_node` rows and no budget: creating one would put the same money in a control point's
  subtree twice, which is the double-ceiling defect `budget_node` exists to prevent.
- **21 state an amount that differs from the money beneath them.** Structure is created, the
  amount is not, and both figures are reported.

A budget is created at whatever node holds it — a node may have children and still carry money.
The rule is about not counting the same money twice, not about leaves.

### The plan has two sections, and only one of them is budgeted

Found while reading the sheet, not while designing: three rows the reader could not parse turned
out to be the file's own totals, and they split the plan in two.

| section | departments | rows | total | the file's own subtotal |
|---|---|---|---|---|
| `ລວມ ຍອດ ມີງົບ` — budgeted | 1–13 | 464 | 397,602,636,355 | matches exactly |
| `ລວມ ຍອດ ບໍ່ມີງົບ` — not budgeted | 14–20 | 89 | 16,017,168,000 | matches exactly |
| `ລວມ ຍອດ ທັງໝົດ` | | | 413,619,804,355 | matches exactly |

All three agree with the figures derived here to the kip, which is the strongest confirmation
available that the right column is being read.

Departments 14–20 are money the customer has NOT budgeted — the names say so
(`15 ພະແນກບໍລະຫານ ລາຍຈ່າຍໃໝ່ທີ່ອາດຈະເກີດຂຶ້ນ`, "new expenditure that may arise"). Importing them as
ordinary budgets would create 16,017,168,000 LAK of spendable budget out of rows their owner
classified as unbudgeted, and nothing would look wrong.

They are imported as **structure with a zero budget**: the departments and nodes exist, a `budget`
is created at each holder with `amount_total` of `0`, and its control point therefore blocks
anything. That is what "not budgeted" means operationally — and it keeps somewhere for the 89 rows
and 8,729,095,321 LAK of spend those departments have already incurred, which the next change has
to land somewhere true.

*Alternative rejected — import their stated amounts.* It reads the number in the 2026 column as an
appropriation when the file's own subtotal says it is the opposite.

*Alternative rejected — skip them.* Their spend exists; a plan that cannot hold it would send the
next change looking for a home for 3.9% of the company's expenditure.

### The 21 conflicts are reported, never resolved

They are not noise; they are large and they cluster. The five biggest:

| code | states | money beneath | gap |
|---|---|---|---|
| `12.1 ເຄຍຄະດີຕ່າງໆ` | 5,319,600,000 | 22,237,031,916 | −16,917,431,916 |
| `12.11 ງວດລົດຕັດໃນ 513` | 1,955,398,788 | 15,924,369,516 | −13,968,970,728 |
| `3.1 ຄ່າໂຄສະນາ` | 1,410,000,000 | 8,902,500,000 | −7,492,500,000 |
| `11.11 ສ່ວນແບ່ງຍອດແຈກຢາຍ` | 511,314,120 | 6,817,038,822 | −6,305,724,702 |
| `1.2 ຈ່າຍ ປະຈຳປີ` | 1,041,320,000 | 4,979,105,000 | −3,937,785,000 |

They trace to one recurring shape — a two-digit tail (`12.11`, `11.11`, `1.11`, `2.21`, `6.11`,
`8.31`) whose place in the plan the code cannot settle: read as a child of `12.1` its money is a
duplicate, read as a sibling it is an allocation of its own, and the department total agrees with
neither reading everywhere. Taking either answer silently would move billions of kip.

So: import the structure, leave the amount out, name it in the report. The department totals it
affects are reported too, so a reader sees 16 departments reconciling exactly and 4 not, with the
figures.

### Departments come from the plan, under one parent

The plan is written against 20 departments and the system has 2. The importer creates the missing
ones with `dept_code` = the plan's root code and the row's name, matching an existing department by
`dept_code` first so a second run adds nothing, and never renaming one. A department the plan does
not name is left alone.

They are created **beneath a single parent department**, created too if absent. Two reasons, both
found while implementing rather than while designing:

- `BudgetPlanService.create` refuses a line whose department is outside the routing department's
  subtree, because the plan is approved by that department's workflow. Twenty flat roots have no
  common routing department, so no plan could carry more than one of them.
- A control point placed on the parent governs the whole company's plan, which is the ceiling a
  finance director actually asks for. Twenty roots can only ever be governed twenty times over.

### The plan document type has to be enabled per department

`BudgetPlanService.create` resolves a `dept_doc_type` for the routing department, and a company
that has never raised a budget plan in a department has none — the customer's database has zero
rows for `BUDGET_PLAN` against any department. Eighteen new departments would each need one.

The importer creates the missing mapping for each department it plans against, reusing the
company's existing `BUDGET_PLAN` form template and an active workflow. It does NOT invent a
workflow: if the company has none, the run is refused saying so, because inventing an approval
route is inventing who is allowed to approve budgets.

*Alternative rejected — have the operator create twenty mappings by hand first.* It is the same
work, done in a screen, with twenty chances to miss one and no report saying which.

### Budgets are put in force the ordinary way

Creating `ACTIVE` budget rows directly would leave all 241 ungoverned: control points are minted by
`BudgetPlanService.activate`, and nothing else mints them. Every governed-set read would return
empty and every submission against them would be refused for want of coverage — or, worse, allowed.

So the importer creates DRAFT budgets and one budget plan document per department, then activates
each through the same service the application uses. The approval trail says an import put them in
force, which is true and better than a fabricated approver.

*Alternative rejected — mint control points in the importer.* Two places that mint coverage, and
the one nobody looks at would drift from the rule about minting the fewest points that cover a plan.

### The stale account guard has to go first

`BudgetPlanService.activate` refuses a budget whose `account` is null, saying no control point can
be scoped to it. Forty lines below, the point it mints is scoped to `budget.node` — the comment
there even records that it used to hang off the account and no longer does. The guard is left over
from before `budget_node`, and since `CreateBudgetDto` made `gl_account` optional in the same
change, a budget created without one can be created and never activated.

Not one line of the customer's plan names an account. The guard is removed with a test that
activates a budget carrying none.

## Risks / Trade-offs

- **The chosen hierarchy is wrong somewhere** → the tree affects which control point governs what,
  not how much money exists. The dry run prints every derived parent, and the 21 conflicts are
  where the risk concentrates; a wrong parent elsewhere is correctable in the admin screen.
- **The 21 conflicts are read as "the import lost money"** → the report states the department
  totals both ways, so the 2,917,005,848 LAK difference is visible as an unresolved question rather
  than a silent shortfall.
- **Activating 241 budgets mints a lot of control points** → activation already mints the fewest
  that cover a plan, per department. Measured after the run: 241 points for 241 budgets, one each.

  That looked thin when it was measured — no department-level ceiling, so nobody can ask "what is
  department 1 allowed to spend". It is the right shape anyway, and **a department-level ceiling
  must not be added without deciding what happens to the lines beneath it**.

  Their own spreadsheet shows why. 172 of its 553 rows carry a negative remaining balance, totalling
  −62,251,673,650, and every department they roll up into still reads positive:

  ```
  ພະແນກ 7   budget 183,490,305,000   used 89,951,025,873   remaining 93,539,279,127   ← healthy
     └── 7.502, 7.402, 7.509, 7.206, 7.512 … several billion overspent between them
  ```

  A control point sums its whole subtree, so a point at the department would grant exactly that
  cover: `7.502` could keep drawing as long as department 7 has room somewhere else. In a
  spreadsheet the roll-up only HIDES the overspend; in this system it would AUTHORISE it. One point
  per budget is what keeps each line answerable for itself, and a department point should only ever
  be added on top of the line points, never instead of them.
- **Creating 18 departments is a bigger footprint than an import usually has** → they are the
  plan's own departments, the plan is unusable without them, and a second run creates none.
- **`3.1` appears twice** (`ຄ່າໂຄສະນາ` 1,410,000,000 on row 162 and `ຄ່າໂປໂມຊັ້ນ` 7,492,500,000 on
  row 175) → the first row is kept, the second set aside, and both are reported. This refused the
  whole run in the first cut; the owner asked for the plan to come in regardless, and holding 552
  correct lines hostage to one spreadsheet question does help nobody. The promotion money is not
  lost with the dropped row: `3.1001`–`3.1003` state the same 7,492,500,000 between them and become
  budgets in their own right.

## Migration Plan

1. Remove the account guard; run the budget suite.
2. `pnpm import:budget-plan --company HAL --dry-run <workbook>` — reports departments to create,
   nodes, budgets, the 21 conflicts, and per-department reconciliation. Writes nothing.
3. Settle `3.1` and decide whether any of the 21 should carry money. Re-run the dry run.
4. Run it. Confirm: 20 departments, 553 nodes, 241 budgets totalling 410,702,798,507, every budget
   ACTIVE and governed by at least one control point.
5. Spot-check in the app that a document line can charge `1.101` and that its control point's
   ceiling is the subtree total a department head recognises.

**Rollback**: budgets that have never been charged can be deleted with their plan documents and
control points, by company and fiscal year. Once a `budget_txn` row exists, nothing is deleted —
the ledger is append-only, and the correction is an adjustment.

## Open Questions

- Which of the 21 conflicting rows are allocations of their own and which are summaries. The import
  proceeds without them; adding one afterwards is a single budget in the app.
- Whether `3.1`'s two rows are two different plan lines that need distinct codes, or one row
  entered twice.
- Departments `9 ບັນຊີ` and `13 ລະບົບຂາຍມວນ` state a zero annual budget while lines beneath them
  carry 600,000,000 and 541,263,060. The lines are imported; whether the departments are meant to
  hold zero is theirs to say.

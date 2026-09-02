## 1. Clear the stale account guard first

> Nothing else in this change can be verified until it is gone: not one line of the customer's
> plan names a GL account, so today not one of them could be activated.

- [x] 1.1 Remove the `if (!budget.account) throw` guard from `BudgetPlanService.activate`. Leave a
      comment saying it predates `budget_node` and that the point minted below is scoped to
      `budget.node`, so it is not restored.
- [x] 1.2 Test: a plan carrying a budget whose `gl_account` is null activates, and a control point
      scoped to that budget's node governs it.
- [x] 1.3 Confirm the existing activation tests — coverage, the fewest-points rule, the lock order,
      the closed-year refusal — still pass untouched.
- [x] 1.4 Update the deterministic-order comment and any test naming `gl_account` as the tiebreak:
      the code orders by the node now. (The sort already read `node.code`; only the docblock above
      it still said `gl_account`. `account` also dropped out of the activation populate — nothing
      reads it there any more.)

## 2. Read the plan sheet

- [x] 2.1 `plan-import/plan-reader.ts`: reuse `chart-import/workbook-reader` for the workbook, and
      locate the header row by its labels (`ລະຫັດ` and `ງົບປະມານ/ປີ2026`) rather than by offset.
- [x] 2.2 Return one row per plan line: code, name, annual amount, source row number. Ignore the
      level column in col 0 — measured as inconsistent with any depth reading — and ignore the
      monthly, quarterly, prior-year and actuals columns.
- [x] 2.3 Unit-test against the real workbook: 553 plan rows, 552 distinct codes, 314 rows (313
      codes) carrying a 2026 amount, and the departments' stated total of 413,619,804,355.
      (Measured during 2.3: the sheet holds four rows that are not plan lines. One is the float
      artifact `8.10900000000001`; the other three are the file's OWN totals, which is how the two
      sections in 3.2b were found. The reader reports them rather than dropping them.)

## 3. Derive structure and classify the money

- [x] 3.1 `plan-import/plan-tree.ts`: split a code at the separator; the part before it is the
      department. Parent = the row whose tail is the longest proper prefix of this tail present in
      the plan, else the department.
- [x] 3.2 Test the two shapes that break naive rules: `10` is a department, never a child of `1`;
      and with `1.1`, `1.11`, `1.111` present but no `1.10`, `1.111` sits under `1.11` while
      `1.101` sits under `1.1`.
- [x] 3.2b Split the sheet at its own subtotal rows (`ລວມ ຍອດ ມີງົບ` / `ລວມ ຍອດ ບໍ່ມີງົບ`): rows
      after the first are the UNBUDGETED section. Assert the two subtotals the file states —
      397,602,636,355 and 16,017,168,000 — against the departments read from each side, and refuse
      the run if either disagrees. The file checking itself is the best confirmation available that
      the right column is being read.
- [x] 3.2c Force `amount_total` to zero for every holder in the unbudgeted section, keeping its
      node and its department. Test that a stated 3,588,000,000 becomes a zero budget.
- [x] 3.3 Classify every row carrying an amount: **holder** (no amount anywhere beneath),
      **summary** (equals the sum of the holders beneath), **conflict** (differs from it).
- [x] 3.4 A code stated twice keeps its FIRST row; the rest are set aside and reported with both
      rows. (Changed from refusing the run, at the owner's direction: the plan comes in and the
      question is reported rather than blocking 552 correct lines.)
- [x] 3.5 Return a plan: departments to create, nodes, budgets (holders only), conflicts, and a
      per-department reconciliation of stated total against the budgets beneath it.
- [x] 3.6 Unit-test the classification against the real workbook: 552 nodes, **241 budgets
      totalling 394,685,630,508**, 51 summaries, 21 conflicts, `12.1` reported with both
      5,319,600,000 and 22,237,031,916, and the file's own three subtotals reproduced exactly.
      (Corrected during 3.6: the proposal's 410,702,798,507 was the sum of every holder BEFORE the
      unbudgeted section is zeroed and before the conflicts are withheld. What is created is
      394,685,630,508 — short of the budgeted section's 397,602,636,355 by exactly the
      2,917,005,847 the conflicts account for. Five of the thirteen budgeted departments reconcile
      to the kip, not sixteen of twenty: that earlier figure compared against leaf sums, which
      included money this import deliberately does not create.)

## 4. Write

- [x] 4.1 `plan-import/plan-import.service.ts`: resolve the company and the fiscal year by their
      codes, refusing an unknown one by name and refusing a run that names neither.
- [x] 4.2 Create the departments the plan names and the company lacks, matching an existing one by
      `dept_code` and never renaming it, **beneath a single parent department** created when absent.
      (Found in 4.5: `BudgetPlanService.create` refuses a line outside the routing department's
      subtree, so twenty flat roots can never share a plan.)
- [x] 4.2b Create the `dept_doc_type` mapping for the budget-plan type on each department the
      import raises a plan against, reusing the company's published template and an active
      workflow. Refuse the run — naming what is missing — when the company has no active workflow.
      (The customer's database holds zero such mappings.)
- [x] 4.3 Create `budget_node` rows for the whole structure, parents in a second pass, the way the
      chart import does.
- [x] 4.4 Create the holders as `DRAFT` budgets at their nodes, in the department their root names.
- [x] 4.5 Create one budget plan document per department and activate it through
      `BudgetPlanService`, so control points are minted by the one path that mints them.
- [x] 4.6 Wrap the run so a failure part-way leaves the company as it was, and stamp the named
      company on every row (invariant 1).
- [x] 4.7 DB-backed test: import the real workbook into a fresh company. (Unblocked once a
      duplicated code stopped refusing the run — see 3.4. The DB-backed spec now reads the real
      workbook end to end and asserts the duplicate is reported rather than fatal; the write path
      is asserted against a synthetic plan of the same shape.) Was: **BLOCKED** on the
      duplicate `3.1` — the importer refuses the customer's file, which is the specified behaviour,
      so this cannot be asserted until somebody settles which plan line owns that code. What is
      asserted instead: the refusal itself, and the whole write path against a synthetic plan of
      the same shape (summary, lines, an unbudgeted section) — departments under one parent, money
      only where it is held, zeroes in the unbudgeted section, every budget ACTIVE and governed,
      and a second run creating nothing.
- [x] 4.7c Make the import RESUMABLE: plan every DRAFT budget of the year, not only the rows this
      run inserted. (Found in 6.2: the first real run wrote 241 budgets and then failed to raise
      their plans; every later run found them present, created nothing, and so never retried —
      the budgets would have stayed DRAFT for ever.)
- [x] 4.7d Wrap the CLI in MikroORM's `RequestContext`, which is what the HTTP layer gives every
      service. (The failure behind 4.7c: `BudgetPlanService` reaches for the global EntityManager,
      which MikroORM refuses outside a context. The script had swallowed the message.)
- [x] 4.7b The plan document is marked COMPLETED after activation rather than left awaiting an
      approval nobody will give. (Found in 4.5: `plans.create` only raises the document; the
      post-action that mints control points is `plans.activate`, and calling one without the other
      left every budget DRAFT and ungoverned while the tests still passed on counts.)
- [x] 4.8 DB-backed test: every imported budget is governed by at least one control point, and the
      importer created none itself.
- [x] 4.9 DB-backed test: a category that states the total of its lines produces ONE ceiling, not
      twice it — the double-count this classification exists to prevent.
- [x] 4.10 DB-backed test: a second run creates nothing, and a name edited in the app survives it.
- [x] 4.11 DB-backed test: a failure during the write transaction leaves no department, node or
      budget. (Scoped to the first half deliberately: departments, nodes and budgets share one
      transaction, while the plans are raised after it because `BudgetPlanService` opens
      transactions of its own. A company left holding 20 departments and 552 nodes with no budgets
      would look imported and be useless — and 4.7c is what lets a re-run finish the job.)

## 5. The command

- [x] 5.1 `back/scripts/import-budget-plan.ts` taking `--company`, `--fiscal-year`, `--dry-run` and
      the workbook path; register `import:budget-plan` in `back/package.json`.
- [x] 5.2 Report: departments created, nodes, budgets and their total, then the conflicts with both
      figures, then the per-department reconciliation. The 21 conflicts and the 0.7% difference
      must be impossible to miss — a report of totals alone would read as complete success.
- [x] 5.3 `--dry-run` opens no write transaction and reports the same counts the real run reports,
      asserted by a test running both over the same workbook.

## 6. Verify against the real thing

- [x] 6.1 Dry-run the customer workbook against the running database and read the report end to
      end. (The command resolves company, fiscal year, plan document type, published template and
      an active workflow against `erp_uitest`, then refuses the workbook: `3.1` is stated twice,
      rows 162 and 175. That is the specified behaviour, so the report itself cannot be read until
      the duplicate is settled.)
- [x] 6.2 Import into `HAL Co` for fiscal year 2026, then confirm in the app: the Budgets list shows
      the plan under its departments, a control point's ceiling equals the subtree total a
      department head would recognise, and a document line can charge `1.101`.
- [x] 6.3 Confirm in Postgres: 244 budgets all ACTIVE (241 imported + 3 pre-existing), 244 control
      points, ZERO ungoverned under the ancestor-walking rule, 10 ledger rows unchanged — the
      import wrote none. Total 394,687,430,508. Was: 241 budgets summing to 410,702,798,507, every one `ACTIVE`, none
      ungoverned, and no `budget_txn` row written by the import.
- [x] 6.4 Mutation-check the double-count rule: create a budget for summary rows as well, and
      confirm 4.9 fails. A doubled ceiling raises no error on its own — it just quietly lets twice
      the money through. (Making every money row a holder fails **10 tests** across the unit and
      DB-backed specs; restoring returns 71/71.)
- [x] 6.5 Backend suite green (1,824 passed, 36 skipped); `tsconfig.build.json` clean. (Noted:
      `tsconfig.build.json` EXCLUDES `scripts/`, so a wrong constructor arity in the new command
      survived every check and only failed when it was run. The scripts are typechecked separately
      now; worth a project-level fix so the next one cannot.)
- [x] 6.6 Sync both specs into `openspec/specs/` and archive the change.

## 7. Record before closing

- [x] 7.1 Note which of the 21 conflicts the customer settled and how. **None were settled.** The
      owner's direction was to let anything unclear through and have users correct it later, so the
      21 conflicting rows were imported as structure with no budget of their own, and the duplicate
      `3.1` kept its first row. The 2,917,005,847 LAK they account for is absent from the system by
      decision, and the report names every one of them. Whoever revisits this needs the customer to
      answer per row, not a rule.
- [x] 7.2 Note that the account guard removed in task 1 was drift left by `budget-by-purpose-not-
      by-account`: the spec said the control point was scoped to `account_id` while the code
      already scoped it to `node_id`. Worth carrying forward as the kind of leftover a
      consumer trace catches. Two more of the same kind surfaced while implementing, both of them
      code that agreed with an older design and had never been re-read: `deterministicOrder`'s
      docblock still named `gl_account` as its tiebreak while the sort already used the node, and
      the activation populate still loaded `account` that nothing read.

- [x] 7.3 Record what the run against production-shaped data found, because none of it is in the
      tests: 125 spent plan codes have **no budget to charge** (32,700,999,830 LAK, 14.8% of their
      expenditure) because the "money lives where the file puts money" rule leaves a blank plan row
      without a budget. The spend-history import must create a zero budget for these — see
      `see-spending-by-quarter`, which carries the analysis and the customer's own numbers.

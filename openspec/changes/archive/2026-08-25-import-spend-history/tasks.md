## 0. Before starting

- [x] 0.1 Read design.md. Six decisions, each with the alternative it beat and the measurement that
      settled it. The grain in particular was already agreed once as one document per budget and
      reversed — the reason is written down.
- [x] 0.2 Note what makes this import different from the two before it: **it writes `budget_txn`**.
      Nothing else this repo imports touches an append-only ledger, and a duplicated row there can
      only be answered with a compensating entry, never removed.

## 1. Reading the monitoring sheet

- [x] 1.1 `spend-import/spend-reader.ts`: read the `ຕິດຕາມງົບປະມານ` sheet through the workbook
      reader `chart-import` already has. Locate the header by its labels, not by row number.
- [x] 1.2 Per row return: `ເລກລຳດັບ`, day/month/year, department code, plan code, description, and
      the kip figure from the computed column — **not** the per-currency columns, which are the
      inputs to it.
- [x] 1.3 Collect rows with no amount or no usable month into a reported list rather than dropping
      them. Do not read `ໝາຍເຫດ` at all.
- [x] 1.4 Unit-test against the real sheet: 5,715 rows carrying a plan code, 5,713 with a
      description, 0 with a negative amount, 25 with no amount, 1 with an unusable month, 3 with
      money and no plan code (212,345,600 between them), and an importable total of
      **221,259,490,412** over **5,689** rows.

## 2. Grouping

- [x] 2.1 `spend-import/spend-plan.ts`: group by (plan code, month). The BUDGET comes from the plan
      code; the department column is carried onto the document and never used to pick the budget.
- [x] 2.2 Produce, per group: the document's date, its department, its lines in sheet order, and the
      summed amount.
- [x] 2.3 Identify plan codes with spending and no budget — the list to create at zero.
- [x] 2.4 Unit-test against the real sheet: **1,187 groups**, 5,689 lines, 317 codes charged, and
      the 16 rows whose department column disagrees with their code resolved to the code's budget.
      The 125 codes needing a zero budget are asserted in the DB-backed test instead — which codes
      have a budget is a fact about the database, not about the file.
- [x] 2.5 Unit-test the quarterly totals the grouping implies — 97,205,850,640 / 90,365,434,886 /
      33,688,204,886. These are the customer's own figures; if the grouping cannot reproduce them
      the read is wrong.

## 3. Writing

- [x] 3.1 `spend-import/spend-import.service.ts`: resolve company and fiscal year, refusing an
      unknown one by name.
- [x] 3.2 Create the missing budgets at zero, at the node the code names, `ACTIVE`, before any
      document is written.
- [x] 3.3 Create one document per group with its lines, `COMPLETED`, its own document type, and an
      external source so a re-run reuses it.
- [x] 3.4 Write `RESERVE` + `ACTUAL` per document, same amount, both dated in the group's month, no
      `RELEASE`.
- [x] 3.5 One transaction for the whole run (invariant: a part-way failure leaves nothing), and the
      named company stamped on every row (invariant 1).
- [x] 3.6 DB-backed test: a budget of 1,000,000 charged 250,000 reports 750,000 available — the
      assertion that proves `RESERVE` alone and `ACTUAL` alone are both wrong.
- [x] 3.7 DB-backed test: no `RELEASE` row is written, and every ledger row falls in the month of
      its spending.
- [x] 3.8 DB-backed test: a second run creates nothing, and every budget's consumed figure is
      unchanged after it.
- [x] 3.9 DB-backed test: a failure part-way leaves no document, line or ledger row.
- [x] 3.10 DB-backed test: another company in the same database gains nothing.

## 4. The command

- [x] 4.1 `back/scripts/import-spend-history.ts` taking `--company`, `--fiscal-year`, `--dry-run`
      and the workbook; register `import:spend-history` in `back/package.json`. Wrap it in
      MikroORM's `RequestContext` — the plan import failed silently for want of it.
- [x] 4.2 Report: documents, lines and ledger rows written; budgets created at zero, each named with
      what was charged to it; rows skipped with the reason; **and the per-quarter and per-department
      totals**, which are what the operator compares against the customer's sheet.
- [x] 4.3 `--dry-run` opens no write transaction and reports the same counts as the real run,
      asserted by a test that runs both.
- [x] 4.4 Typecheck the scripts. `tsconfig.build.json` excludes `scripts/`, which is how a wrong
      constructor arity reached a live run of the last importer.

## 5. Verification

- [x] 5.1 Backend suite green; `tsconfig.build.json` clean; scripts typechecked.
- [x] 5.2 **Mutation-check the reserve/actual pair**: write `ACTUAL` alone and confirm 3.6 fails. A
      budget that reports its full balance after being spent through is the failure this pair
      exists to prevent, and it raises nothing on its own.
- [x] 5.3 **Mutation-check the grain**: group by year instead of month. 2.5 does NOT fail — the
      quarterly totals are summed per ROW, so they stay right whatever the grain is, which is
      exactly why the grain needs its own assertions. What fails is 2.4 (1,187 documents becomes
      317) and the DB-backed *dates every ledger row in the month of its spending* — the one that
      states the actual defect: every ledger row lands in January.
- [x] 5.4 Dry-run the customer workbook against `erp_uitest` and compare the reported quarterly
      totals with theirs before writing anything. Reproduced to the kip: 97,205,850,640 /
      90,365,434,886 / 33,688,204,886.
- [x] 5.5 Imported for real into `erp_uitest`. The quarterly REPORT SERVICE — the read path the
      view calls — now returns 97,205,850,640 / 90,365,434,886 / 33,688,589,886 over 21
      departments. Q3 is 385,000 above the import's own figure because `erp_uitest` already held
      10 ledger rows from earlier UI testing. The browser itself was not opened; the numbers come
      from `BudgetQuarterService.byQuarter` against the imported database.
      **The first run failed** — `document_line.description` is varchar(255) and 44 rows state more
      than that — and left NOTHING behind, which is the atomicity requirement demonstrated on real
      data rather than in a test.
- [x] 5.6 Confirmed in Postgres: 1,187 documents, 5,689 lines, 2,374 ledger rows (RESERVE
      221,259,490,412 = ACTUAL 221,259,490,412), no `RELEASE`, none without a document, every row
      dated on its month's first day, and 121 control points minted — 4 of the 125 budgets were
      already governed by an ancestor's point (`1.12`, `1.41`).
- [x] 5.7 Compared per department against `ຍອດໃຊ້ງົບ/ປີ` in their own plan sheet. **17 of 20
      reconcile to the kip.** The three that differ are all cases where their spreadsheet's
      subtotal formula misses cells its own rows contain — see 6.1.
- [x] 5.8 Synced to `openspec/specs/spend-history-import/` (10 requirements, 24 scenarios)
      and archived on 2026-08-25.

## 6. Record before closing

- [x] 6.1 **Where the system differs from the customer, and why.** Three departments, the system
      higher by 929,934,363 in total, and every kip of it explained by their own sheet:

      | dept | theirs | the system | difference | why |
      |---|---|---|---|---|
      | 18 | 667,002,006 | 865,484,149 | +198,482,143 | their `18.1` subtotal formula does not
        cover all of their own `18.1xx` rows |
      | 19 | 2,901,553,692 | 3,347,281,712 | +445,728,020 | 317,418,020 the department row omits
        from its own categories, plus 128,310,000 charged directly to the summary code `19.2` |
      | 20 | 602,420,180 | 888,144,380 | +285,724,200 | charged directly to the summary code
        `20.1`, which their category figure excludes |

      Not a defect to tune away: the system sums the rows, their sheet sums a formula, and where
      the two disagree the formula is skipping cells. This is the same failure that makes their
      172 negative lines vanish on roll-up. Worth showing to the budget department.
- [ ] 6.2 Note whether the 1,187 imported documents were acceptable in the document list, or whether
      they need filtering out by default. Nobody has seen them yet — they carry their own type,
      `SPEND_HIST`, so the list can exclude them the moment somebody says they are in the way.
- [x] 6.3 The archived `see-spending-by-quarter` design has been amended to say that its
      recommendation counted documents and never mentioned lines, and that this change keeps its
      grain and adds the 5,689 lines. Both revisions came from somebody looking at what the grain
      threw away.
- [x] 6.4 **Two things found in implementation that the design had not settled**, both now written
      into design.md and the spec:
      1. A budget created ACTIVE and governed by no control point is not merely unchecked — it is
         unspendable, because `reserve` refuses it. All 244 existing points sit on leaf nodes, so
         all 125 would have been ungoverned. The import now mints them and fails the run if any
         budget is left uncovered.
      2. `document_line.description` holds 255 characters and 44 rows state more. The words are
         cut and the sheet reference kept, because the reference is what leads back to the full
         text.
- [x] 6.5 Pre-existing in `erp_uitest`, not from this import: the seed budget `5000`/`PROC` is
      ACTIVE and governed by no control point. Worth a look, separately.

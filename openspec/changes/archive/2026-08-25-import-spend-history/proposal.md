## Why

The customer's 2026 plan is in the system — 241 budgets, 394,685,630,508 LAK — and not one kip of
it has been spent, because the spending lives in a fourth sheet of the same workbook that nothing
has read yet. **5,689 importable rows, 221,259,490,412 LAK, 53% of the plan**, and every budget figure the
system can state today is wrong by that amount.

The quarterly view shipped alongside this is empty until these rows land, and its own tests are the
only thing exercising it.

Measured against the sheet:

| | |
|---|---|
| rows carrying a plan code | **5,715** — of which **5,689** carry an amount and a usable month |
| total | **221,259,490,412** LAK |
| Q1 / Q2 / Q3 (to 10 Aug) | 97,205,850,640 / 90,365,434,886 / 33,688,204,886 |
| rows carrying a description | **5,713 of 5,715** |
| distinct budget codes charged | 317 |
| …of which the system has a budget for | 192 — **125 do not exist**, 32,700,999,830 LAK |
| rows with a negative amount | **0** |
| real document numbers to preserve | **2 of 5,715** — effectively none |

## What Changes

- A **CLI importer**, `pnpm import:spend-history`, reading the `ຕິດຕາມງົບປະມານ` sheet of the same
  workbook the plan came from. Same posture as the two imports before it: operator-run,
  `--company` and `--fiscal-year` required, `--dry-run` first.
- **One document per budget per month, carrying the real spend rows as its lines.** 1,187
  documents, **5,689 `document_line` rows**, 2,374 `budget_txn` rows. The month keeps the time
  dimension the quarterly view needs; the lines keep the 5,712 descriptions that a monthly total
  would throw away. This is what a document already is in this system — several lines, one reserve
  per budget summing them — so nothing is bent to fit.
- Each document writes **`RESERVE` + `ACTUAL` of the same amount, on the same date, with no
  `RELEASE`**. Reserve alone would leave money committed forever; actual alone would not reduce the
  budget at all, because `ACTUAL` is not a deduction (invariant 3) — it converts a reserve into
  spend. Both, and the budget falls by exactly what was spent.
- **A budget of zero is created wherever spending has nowhere to land.** 125 codes, 32,700,999,830
  LAK — 110 of them plan rows whose annual figure the workbook left blank while they were spent on
  every month, `7.502 ເງິນເດືືອນ ພະນັກງານ ພາຫະນະ` at 3,675,828,099 among them.
- **The budget is chosen by the plan code, not by the department column.** 16 rows disagree between
  the two; the code says whose budget was consumed and the department column says who spent it,
  and only the first is a budget question.
- **`ເລກລຳດັບ` becomes the import's external reference.** 99% of rows carry one and 5,609 are
  distinct, so the document module's existing idempotent-by-source creation makes a re-run safe
  without inventing a key.

## Capabilities

### New Capabilities
- `spend-history-import`: bringing an existing year's expenditure into the ledger from the
  customer's own monitoring sheet — grouped so the time dimension survives, detailed so the
  descriptions do, and landing on budgets that exist or are created at zero to receive it.

### Modified Capabilities
None. Every row is written through the shapes the system already has: a document with lines, a
reserve, an actual. No column is added and no invariant is relaxed.

## Impact

- **New**: `back/src/modules/budget/spend-import/` (reader, grouping, writer) and a
  `back/package.json` script. The workbook reader from `chart-import` is reused again.
- **Writes to `budget_txn`** — the first import that does. Invariant 2 holds by construction
  (inserts only), invariant 3 by writing the reserve/actual pair, and invariant 4 by writing the
  lifecycle in the order it really happens.
- **1,187 documents appear in the document list.** They carry their own document type so they can
  be told from documents anyone actually raised, and they are `COMPLETED` on arrival — an import
  of last year's spending is not waiting for an approval.
- **After this the system's figures can be compared with the customer's**: their spreadsheet's
  quarterly totals, their per-department remaining, and their 172 negative rows should all be
  reproducible. Until now there has been nothing to compare.
- **Out of scope**: the `ລາຍຮັບ` revenue sheet, the weekly detail in `ສາລະບານງົບປະມານ (2)`, and any
  attempt to reconcile the workbook's own contradictions — the 21 conflicting plan rows are still
  absent by decision and this import does not revisit them.

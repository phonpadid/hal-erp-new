## Context

The `ຕິດຕາມງົບປະມານ` sheet of `data/budget/8ໂມງ48-16-6- 2026 Monitoring budgetplan 2026 30-6-2026
(5).xlsx`. One row per disbursement, 5,715 of them carrying a plan code, header on row 4:

| col | | |
|---|---|---|
| 2 | `ເລກລຳດັບ` | a running number — 99% filled, 5,609 distinct. The only key the sheet has. |
| 5, 7, 8 | `D`, `M`, `Y` | day, month, year — **all three present on every row** |
| 9 | `CODE ພະແນກ` | the department that spent |
| 10 | `CODE (.)` | the plan code charged |
| 13 | the description | present on 5,713 of 5,715 |
| 14–17 | `ກີບ` `ບາດ` `ຢວນ` `ໂດລາ` | the amount in the currency it was paid in |
| 18 | `ອັດຕາແລກປ່ຽນ` | the rate applied |
| **19** | | **`= (kip + baht + yuan + dollar) × rate` — the kip figure this import reads** |
| 20 | `ໝາຍເຫດ` | `ຈ່າຍແລ້ວ` on 36% of rows, spelled 26 different ways |

**What the ledger requires.** `budget_txn.document_id` is NOT NULL: every row of the budget ledger
points at a document. That single constraint decides the shape of this import — history without
documents cannot be expressed, so documents have to be made.

**What the plan import left behind.** 241 budgets across 20 departments hanging under a `PLAN`
parent, and 125 of the codes this sheet charges have no budget at all.

## Goals / Non-Goals

**Goals:**
- Every kip of the 221,259,490,412 in the ledger, attributable to the right budget and the right
  month.
- The descriptions survive. They are the only human-readable record of what the money bought.
- Re-running changes nothing.
- The system's figures become comparable with the customer's own spreadsheet, per quarter and per
  department.

**Non-Goals:**
- Reconciling the workbook's contradictions. The 21 conflicting plan rows stay absent; this import
  does not decide them.
- Distinguishing paid from unpaid. `ໝາຍເຫດ` says `ຈ່າຍແລ້ວ` on 36% of rows in 26 spellings, which is
  not a status anyone can rely on.
- Multi-currency ledger rows. The sheet has already converted every payment to kip in column 19,
  and the budget ledger is kept in the company's base currency, which is kip.
- The revenue sheet, and the weekly detail in the second plan sheet.

## Decisions

### One document per budget per month, with the real rows as its lines

```
   document   PR-HIST-…   budget 7.301 · month 3 · department 7
      ├── line  ຄ່າຈ້າງແຮງງານລາຍວັນ ຂົນເຄື່ອງ        12,500,000
      ├── line  ຄ່າເໝົາລົດນອກ ປະເພດລົດ 12 ລໍ້          8,400,000
      └── line  ຄ່ານໍ້າມັນໂຊເຟີ້ ຕ່າງແຂວງ               3,200,000
                                       ↓
             budget_txn   RESERVE 24,100,000
                          ACTUAL  24,100,000     — same day, no release
```

| grain | documents | lines | descriptions kept |
|---|---|---|---|
| one per budget | 334 | 334 | none — and every quarter collapses into one |
| one per budget per quarter | 652 | 652 | none |
| **one per budget per month** | **1,187** | **5,689** | **all of them** |
| one per spend row | 5,689 | 5,689 | all of them |

Monthly is what their own sheet is kept in — months rolled to quarters — so one import serves the
monthly and the quarterly view. And the line is where a description belongs: a document with
several lines and one reserve per budget is exactly what `budget-ledger.service.ts` already builds,
so nothing is bent to make this fit.

*Alternative rejected — one document per budget (334).* The direction agreed before the quarterly
view existed. A document carries one date, so all 221,259,490,412 would land in a single quarter,
and the view shipped alongside this would be empty of meaning.

*Alternative rejected — one document per spend row (5,689).* Same fidelity, and it puts 5,689
documents nobody raised into the document list, where they would bury the ones people did raise.
The description does not need its own document to survive; it needs a line.

*Alternative rejected — no documents, `budget_txn.document_id` made nullable.* Honest in one
respect — this history really has no documents, and manufacturing them is its own kind of fiction —
but it breaks the property that every ledger row can be traced to something, on a table that
forbids UPDATE and DELETE precisely so that trail holds. Three lines of the workbook are not worth
that.

Three documents are unusually long: `4/4.203` has 417 lines in month 1, 336 in month 2, 330 in
month 3, against an average of 4.8. They are legitimate — daily labour hire — and the importer does
not split them.

### RESERVE and ACTUAL together, on the same day, with no RELEASE

`ACTUAL` is not a deduction. The balance is
`amount_total − Σ RESERVE + Σ RELEASE`, and `ACTUAL` converts a reserve into spend rather than
taking anything further out (invariant 3). So:

| written | effect on the balance | what it would mean |
|---|---|---|
| `ACTUAL` alone | **none** — the budget still reads untouched | the money vanishes from every figure |
| `RESERVE` alone | reduces it | committed for ever, never received |
| **`RESERVE` + `ACTUAL`** | **reduces it by the amount spent** | committed and received, which is what happened |

Both carry the row's own date, so the pair sits in the month it belongs to. No `RELEASE` is
written: the sheet holds no negative amounts at all, so nothing was ever given back.

A useful consequence for the quarterly view: with reserve and actual on one date and nothing
released, its two candidate definitions of consumption — `Σ RESERVE − Σ RELEASE` and `Σ ACTUAL` —
agree to the kip over this whole import. The system reconciles with the customer's spreadsheet from
day one, and only starts to differ once documents are raised in the system.

### A budget of zero is created where spending has nowhere to land

125 of the 317 charged codes have no budget — 32,700,999,830 LAK, 14.8% of the year's spending.

| why | codes | amount |
|---|---|---|
| the plan row exists but its annual figure is blank | 110 | 29,141,817,586 |
| the code is a summary row, charged directly | 7 | 2,606,158,984 |
| other | 8 | 953,023,260 |

This is not a data fault; it is what the plan import's rule — money lives where the file puts money
— leaves behind, and spending against an unbudgeted line is ordinary for this customer at nearly a
sixth of their expenditure.

A budget of `amount_total = 0` is created at the node, in the department the code names, for every
code with spending and no budget. The result reproduces their own sheet exactly:

```
   their sheet   7.502   budget (blank)   used 3,675,828,099   remaining −3,675,828,099
   the system    7.502   budget 0         used 3,675,828,099   remaining −3,675,828,099
```

They already see this: 172 rows of their sheet carry a negative remaining, −62,251,673,650 between
them. What the system adds is that the figure survives being rolled up, which theirs does not.

*Alternative rejected — a zero budget for every plan leaf.* 212 more budgets, most for lines nobody
has ever spent on, to make the same 125 reachable.

*Alternative rejected — refuse and report.* 125 lines is not a list anyone works through, and until
they do, 14.8% of the company's spending is missing from every figure the system states.

### A budget created at zero is put under a control point

Found while implementing, and it corrects the risk note below: a budget created ACTIVE and governed
by nothing is not merely unchecked, it is **unspendable**. `BudgetLedgerService.reserve` refuses a
budget no control point governs — *"this is a configuration fault, not an unlimited budget"* — and
the coverage invariant (D3) says every ACTIVE budget is governed by at least one active point.

Measured in the imported database: all 244 existing control points sit on a plan budget's own leaf
node, so none of them would reach a node created here. All 125 would have been ungoverned.

So the import mints one point per budget it creates, at that budget's own node and department, with
the same BLOCK-at-the-ceiling ladder a plan mints — and re-reads coverage afterwards, failing the
whole run if any budget is still ungoverned. On a budget of zero, BLOCK reads as "the next request
against this line is refused", which is what a line the plan never funded should do: what was
already spent is recorded, and the next kip is a decision for a person.

*This does not contradict "no control point is locked during the import."* Nothing is checked
against a ceiling here — the spending already happened — and `recordHistoricSpend` takes no
coverage locks. What is being fixed is the state the import LEAVES: money that nothing governs.

### The plan code decides the budget; the department column decides the requester

16 rows disagree between the two. The data says which is which:

| department column | plan code | amount | what it is |
|---|---|---|---|
| `12.113` | `12.113` | 1,287,139,980 | the plan code pasted into the department column |
| `15.102` | `15.102` | 980,000 | the same slip |
| `8` | `20.105` | 104,728,400 | one department paying for another's line |
| `6` | `18.101` | 18,571,573 | department 6 paying for the HAL PAY server |

Two are data-entry slips where the code column is authoritative anyway. The other fourteen are
real: a department spent money that came out of another department's budget line. "Whose budget was
consumed" is a budget question and the code answers it; "who spent it" is not, and the department
column is kept on the document, where it is true.

Taking the department column instead would mint fourteen phantom budgets — `18.101` in department
6 — that exist in no plan.

### `ເລກລຳດັບ` is the external reference, so a re-run changes nothing

The sheet carries no document numbers: `ລທ/ພະແນກ` and `ເລກທີ/ການເງິນ` are filled on 2 of 5,715
rows. `ເລກລຳດັບ` is filled on 99% and 5,609 of its values are distinct.

Each document is created with `source_type = 'BUDGET_HISTORY'` and a `source_id` built from the
budget, the month and the year, which the document module's existing idempotent-by-source creation
then makes safe to repeat — the same mechanism a retried external claim uses, not a new one. The
`ເລກລຳດັບ` of each spend row is kept on its line so a figure in the system can be traced back to a
row in their sheet.

*Why not one source id per spend row:* because the document is per month, not per row. The row's
number belongs on the line it became.

### Rows the importer will not guess about

- **25 rows carry no kip amount.** Skipped and named. A line of zero would state that something was
  bought for nothing.
- **1 row has an unusable month.** Skipped and named.
- **Nothing is inferred from `ໝາຍເຫດ`.** Its 26 spellings of `ຈ່າຍແລ້ວ` on 36% of rows cannot
  distinguish paid from unpaid, and this import does not pretend otherwise.

## Risks / Trade-offs

- **1,187 documents nobody raised enter the document list** → they carry their own document type,
  so the list can exclude them and a reader can tell them apart. The alternative grains are 334
  (loses the year's shape) or 5,689 (buries the real documents).
- **The imported documents are `COMPLETED` without an approval trail** → true, and the honest
  representation: an import of last year's spending is not waiting for anybody. The plan import
  set the same precedent for the same reason.
- **A budget created at zero looks like a mistake to someone who has not read this** → it is the
  customer's own figure; their sheet shows the same line with a blank budget and a negative
  remaining. The importer's report names all 125.
- **Writing 2,374 ledger rows in one run is the largest budget write this system has made** →
  every row is an insert into an append-only table, and the run holds one transaction so a failure
  leaves nothing behind. No control point is locked because nothing is being checked against a
  ceiling: this is history, and the ceiling it would have been checked against is the one it
  already consumed.
- **The figures become comparable with the customer's for the first time** → and may not match. The
  reconciliation is the point, and where the two disagree the difference is information, not a bug
  to be tuned away.

## Migration Plan

1. `pnpm import:spend-history --company HAL --fiscal-year 2026 --dry-run <workbook>` — reports the
   documents and lines to be created, the budgets to be created at zero, the rows to be skipped,
   and the per-quarter and per-department totals it will produce.
2. Compare the reported quarterly totals against the customer's own: 97,205,850,640 /
   90,365,434,886 / 33,688,204,886. A difference here means the read is wrong, not the data.
3. Run it.
4. Confirm the quarterly view now shows their year, and that the per-department remaining matches
   their sheet where their sheet is internally consistent.

**Measured against the imported database, dry run of 2026-08-25:** 1,187 documents, 5,689 lines,
2,374 ledger rows, 125 budgets at zero (32,700,999,830), 50 rows left out stating 257,195,600
between them, and quarters of 97,205,850,640 / 90,365,434,886 / 33,688,204,886 — the customer's own
figures, reproduced from their file.

**Rollback**: `budget_txn` is append-only and this is the first import to write it. Before anything
else touches the ledger, the run can be undone by deleting the documents it created — identified by
their `source_type` — and the ledger rows that point at them. After that point, nothing is deleted:
corrections are new rows.

## Open Questions

- Whether the 21 conflicting plan rows should be settled before this import, so their spending has a
  budget with a figure rather than one created at zero. They account for 2,917,005,847 LAK of plan
  and the import works either way — but a budget at zero for a line the plan meant to fund reads as
  overspent when it is really unresolved.
- Whether the imported documents should be visible in the document list at all, or filtered out by
  default. Nobody has seen 1,187 of them yet.
- Whether the three departments where the system now reads higher than their spreadsheet — 18, 19
  and 20, 929,934,363 between them — should be shown to the budget department. Every kip of the
  difference is their own subtotal formula skipping cells its own rows contain, which is the same
  failure that makes their 172 negative lines vanish on roll-up. The system is not wrong here; the
  question is whether anyone tells them.

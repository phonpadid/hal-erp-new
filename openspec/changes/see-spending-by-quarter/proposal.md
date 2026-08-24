## Why

The customer tracks their budget by quarter and the system cannot show a quarter at all. Their
workbook carries a `ໄຕມາດ` column, four `ງົບປະມານທີໃຊ້ໄຕມາດ` columns, a `ສ່ວນຕ່າງ` column and a
per-quarter percentage of the year — and `budget` holds one annual figure, `budget_control_point`
one ceiling, and no report takes a date range.

**This change is about SEEING a quarter, not about limiting one.** That was the first thing
settled, and it is settled on their own evidence:

- The `ສ່ວນຕ່າງ` (variance) column exists for **Q1 only**. The other three quarters carry a
  percentage of the annual figure and no variance at all.
- Their quarterly figure is `annual ÷ 4` in **272 of 293 rows (93%)** — a pace reference, not an
  allocation.
- The 21 hand-set rows encode seasonality (`1.502 ງົບກິນລ້ຽງ ປີໃໝ່ລາວ`: 385,000,000 annual and
  385,000,000 "per quarter" — a Lao New Year party that happens once), and the sheet has **no way
  to say which quarter**. It holds one number, not four.
- Nothing in their process blocks a disbursement when a quarter is full.

A quarterly ceiling would therefore mean inventing four figures per line that nobody has ever
written down — 964 of them — and enforcing them against a plan whose own author could not express
them.

## What Changes

- **A quarterly view of spending**, per budget and rolled to department: what was consumed in each
  quarter of a fiscal year, from `budget_txn.txn_date`, which every ledger row already carries.
- **The comparison is the previous quarter**, not a budget-derived pace line. Their own two sheets
  compute the pace variance differently and reach opposite verdicts on the same department —
  `ພະແນກ ບໍລິຫານ` Q1 is `−203,877,015` (over) in `ສາລະບານງົບປະມານ` and `+12,008,768,161` (under) in
  `ສົມທຽບ`, because one compares against a quarter's budget and the other against three quarters'.
  Three of the eight departments checked flip sign between the two sheets. Choosing either formula
  would put the system permanently at odds with one of their own reports; comparing quarter to
  quarter needs no definition of "the budget for a quarter" at all.
- **A partial quarter is never compared whole.** Their data stops on 10 August: Q3 holds 40 of its
  92 days. Compared whole it reads as a 63% collapse; compared over the same elapsed window it is
  `33,688,204,885` against Q2's `33,723,386,829` — a 0.1% difference, which is the truth.
- **A quarter with no counterpart shows no percentage.** Only 48–58% of budget lines have spending
  in two consecutive quarters. 27–40% stop (an annual licence, a New Year party) and would every
  one of them read `−100%`; 12–15% start (division by zero).

## Capabilities

### New Capabilities
- `budget-period-reporting`: reading budget consumption by fiscal quarter — how much each quarter
  consumed, how it compares with the quarter before it, and how much of the current quarter has
  actually elapsed.

### Modified Capabilities
None required. The quarterly view reads what the ledger already records; nothing about how budget is
reserved, released or governed changes.

A defect in `reporting` was found while settling this and is **recorded, not scheduled**:
`budgetUtilization` reports `0%` used for a budget of zero that has been spent against, because the
percentage divides by the budget. It will mislead about 125 lines and 32,700,999,830 LAK the moment
the spend history lands. Fold it in here or give it its own change — but decide, rather than
letting it ship as a surprise.

## Impact

- **Reads only.** `budget_txn` is unchanged, and no ceiling, policy or reservation path is touched.
  Invariants 2, 3 and 4 are untouched by construction.
- **It depends on the spend-history import being periodised.** This is the part that must be
  recorded before anything else: the earlier direction for the history import was *one opening
  document per budget*, 334 of them. One document carries one date, so all 221,259,490,412 LAK
  would land in a single quarter and this view would be empty of meaning before it was built. One
  document per budget **per month** is 1,197 documents, and every one of the 5,714 spend rows
  carries a usable day, month and year — the granularity is in the data, and only our own choice
  can throw it away.
- **Settled with the budget department**, on a worked example of a 100,000,000 requisition approved
  in one quarter and received in the next: consumption is counted **at approval**
  (`Σ RESERVE − Σ RELEASE`), a release belongs to **the quarter that committed it**, and a closed
  quarter's figure **may move** when a release lands later — the report is for internal use, so
  nothing leaves the building that a later correction would contradict. See design.md.

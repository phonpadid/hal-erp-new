## Context

Everything below was measured from `data/budget/8ໂມງ48-16-6- 2026 Monitoring budgetplan 2026
30-6-2026 (5).xlsx` during the exploration that produced this change. The figures are recorded
because the decisions rest on them, and because re-deriving them costs an hour.

**What the system has today**

| | |
|---|---|
| `budget` | `amount_total` — one annual figure. No period column of any kind. |
| `budget_control_point` | one `cap_amount`, one tolerance ladder. No period. |
| `budget_txn` | **`txn_date`** — a real date, "not the insert time", already deliberate |
| report filters | `fiscalYearId`, `departmentId`. No date range anywhere. |

**What already solves this problem elsewhere in the system**

`quota` has carried a periodic allowance since it was built:

```
        quota                                   budget
   ┌──────────────────┐                   ┌──────────────────┐
   │ limit_value      │                   │ amount_total     │
   │ reset_cycle      │  MONTHLY /        │  —               │
   │ carry_forward    │  QUARTERLY /      │  —               │
   └──────────────────┘  YEARLY / NONE    └──────────────────┘
   ┌──────────────────┐                   ┌──────────────────┐
   │ quota_usage      │                   │ budget_txn       │
   │  period_year     │ ◀ stamped at      │  txn_date        │ ◀ a date, not
   │  period_index    │   write time      │  —               │   a period
   └──────────────────┘                   └──────────────────┘
```

`periodForCycle()` in `quota-period.ts` already computes a quarter index. If a periodic *ceiling*
is ever wanted for budget, that is the shape to copy — and this change is not it.

## Goals / Non-Goals

**Goals:**
- Show what each quarter of a fiscal year consumed, per budget and per department.
- Compare a quarter with the one before it, honestly, including when it is not finished.
- Say plainly when a comparison cannot be made rather than printing a number that misleads.

**Non-Goals:**
- **A quarterly ceiling.** Settled explicitly: "เห็น" not "กั้น". See the proposal for the
  evidence — chiefly that their own variance column exists for one quarter out of four.
- Storing a per-quarter allocation. Nothing in the customer's data can populate one.
- Deciding the comparison against a budget-derived pace line. Their own sheets disagree about it.
- Monthly or weekly views. The data supports both (their second sheet goes to weeks); nobody has
  asked, and quarters are what the conversation was about.

## Decisions

### Quarter against quarter, because their own pace lines contradict each other

`ພະແນກ ບໍລິຫານ`, Q1, from two sheets of one workbook:

| sheet | formula | verdict |
|---|---|---|
| `ສາລະບານງົບປະມານ` | quarter figure − Q1 used | **−203,877,015** over |
| `ສົມທຽບ` | (annual × 0.75) − Q1 used | **+12,008,768,161** under |

Three of the eight departments checked flip sign between them. A third comparison lives in the same
sheet: `ສົມທຽນ ເດືອນ 1` puts one month's spending against one quarter's budget.

None of these is wrong — they answer different questions. But a system that picks one is
overruling a question its owner has not settled, and will disagree with one of their reports
forever. Quarter against quarter needs no definition of "a quarter's budget", and the raw
per-quarter totals agree with every sheet they have, because every sheet computes those the same
way. Only the variance differs.

*Alternative rejected — compare against `annual ÷ 4`.* It is the 93% case and it is defensible,
but it breaks precisely where the customer took the trouble to override it: `1.502
ງົບກິນລ້ຽງ ປີໃໝ່ລາວ` spends 385,000,000 in the quarter the party falls in, against a 96,250,000
pace line. The report would flag their most predictable expense as a 300% overrun every year.

*Alternative rejected — compare against the same quarter last year.* The right comparison for a
seasonal business, and there is no last year: 21 of 553 plan rows carry a 2024 or 2025 figure, and
the ledger starts in 2026.

### Consumption is what a quarter COMMITTED, not what it paid out

Answered by the budget department, asked with this example: a 100,000,000 requisition approved in
June, goods received in July for 80,000,000, 20,000,000 returned.

> **"นับว่าใช้งบตอนอนุมัติ หรือตอนจ่ายจริง?" — ตอนอนุมัติ**

So consumption is `Σ RESERVE − Σ RELEASE`, which is also what the annual `budgetUtilization`
report already uses (invariant 3). The quarterly view and the annual one cannot disagree.

Their spreadsheet counts the opposite — rows marked `ຈ່າຍແລ້ວ`, money actually out. Two things make
that a smaller problem than it looks:

- The two measures **always agree over a complete year**: `Σ RESERVE − Σ RELEASE = Σ ACTUAL +
  outstanding`, and nothing is outstanding once a document finishes. They differ only at a quarter
  boundary a document straddles.
- For the imported 2026 history they agree **exactly**, because an opening document writes its
  `RESERVE` and its `ACTUAL` on the same date and never releases. The system will reconcile to
  their Excel from day one, and only start to differ as documents are raised in the system.

*Alternative rejected — count at payment (`Σ ACTUAL`).* It matches their sheet and it makes the
release-attribution question below disappear entirely. It answers the wrong question, though: money
committed by an approved requisition cannot be spent on anything else, so a budget holder asking
"how much of my quarter is gone" is asking about commitments. The department chose this knowingly.

### A release belongs to the quarter of the reserve it gives back

The consequence of counting at approval: a document reserving in Q2 and releasing in Q3.

```
   Q2:  RESERVE 100  ──┐
   Q3:  RELEASE   30  ◀┘   which quarter gets the 30 back?
```

It goes to **Q2**, the quarter that committed it. Q2 reads 70, Q3 reads nothing.

This is computable today with no schema change: there is exactly **one `RESERVE` per
`(document, budget)`** — the reserve sums a document's lines per budget — so "the quarter this
release belongs to" is unambiguous and reachable through the `document_id` every ledger row
already carries.

The price is that a closed quarter's figure moves when a release lands later. That was asked
directly:

> **"ตัวเลขไตรมาสที่ปิดไปแล้ว ขยับได้ไหม?" — ขยับได้**
> **"รายงานไตรมาสจะเอาไปใช้ทำอะไร?" — ดูภายในเฉย ๆ**

Both answers were needed. Had the figures been fixed, the only honest option would have been to
report the release where it falls and let a quarter show a negative number.

*Alternative rejected — attribute a release to its own date.* Never rewrites the past, which is the
right property for a report that leaves the building. It makes a quarter go negative, and it
reports 100 for a quarter that really committed 70.

*Alternative rejected — stamp the period on the ledger row at write time (the `quota_usage`
pattern).* Same answer, but it writes a new column onto an append-only ledger to store something
derivable from a column already there. Worth revisiting if a periodic *ceiling* is ever built,
where the stamp would be read on the hot reservation path rather than by a report.

### A partial quarter is compared over the elapsed window, never whole

Their data ends on 10 August — 40 days into a 92-day quarter.

```
  whole-quarter comparison            same-elapsed-window comparison
     Q1  97,205,850,640                  Q1  39,492,076,638
     Q2  90,365,434,887                  Q2  33,723,386,829
     Q3  33,688,204,885                  Q3  33,688,204,885
         Q3 is "down 63%"                    Q3 is down 0.1%
```

Month 7 alone spent 30,877,385,580 — level with the 31,262m monthly average of the six months
before it. Nothing changed; only the data ran out. A view that reports a collapse on the strength
of the calendar is worse than no view, because it will be believed once and never again.

So: the current quarter is labelled with how much of it has elapsed, and its comparison is drawn
over the same number of days of the previous quarter.

### No percentage when the other side is zero

Budget lines with spending in two consecutive quarters:

| | comparable | started | stopped |
|---|---|---|---|
| Q2 vs Q1 | 181 (58%) | 48 (15%) | 83 (27%) |
| Q3 vs Q2 | 126 (48%) | 31 (12%) | 103 (40%) |

Fewer than 60% can be compared at all. Rendering the rest as `−100%` and `∞` makes a table where
most rows are noise — and the `−100%` rows are mostly correct-but-meaningless: an annual licence
fee, a New Year party, a once-a-year membership. They are labelled as started or stopped, not
scored.

### A zero budget is reported as overspent, never as 0% used

`budgetUtilization` computes `consumed / amountTotal` and returns `0` when `amountTotal` is zero —
`Money.compare(e.amountTotal, '0') === 0 ? 0 : …`. A budget of nothing that has been spent against
therefore reports **0% used**, which reads as "untouched".

Their spreadsheet has the identical trap, and it is not hypothetical: **115 rows carry spending
against a blank budget**, and the percentage column shows `0` on every one of them.

```
   7.502  ເງິນເດືືອນ ພະນັກງານ ພາຫະນະ
      budget (blank)   used 3,675,828,099   remaining −3,675,828,099   used% 0.00
                                                    ▲                        ▲
                                              says it plainly          says untouched
```

Three columns of one row, and the one that disagrees is the one every summary screen reaches for.

The quarterly view SHALL report a zero-budget line as overspent by the amount consumed, and SHALL
NOT emit a percentage for it. A percentage of nothing is not zero; it does not exist, and saying so
is the only honest rendering.

**Fixed ahead of this change**, because 125 codes and 32,700,999,830 LAK were about to sit under it:
`budgetUtilization` now returns `null` rather than `0`, sorts a budget without a percentage to the
top of the report, excludes it from the average, counts it among the over-budget departments and
labels it "no budget — overspent" instead of drawing an empty bar. Mutation-checked: putting the
`0` back fails two tests.

### The first quarter of the first year says so, rather than inventing a baseline

Q1 2026 would compare against Q4 2025, which neither the ledger nor the workbook holds. It shows
its own figure and, in place of a comparison, that there is no earlier quarter — not a blank cell,
which reads equally as "still loading" or "zero".

The condition occurs once in the system's life and cures itself: 2027 Q1 compares to 2026 Q4.

*Alternative rejected — compare against the average of the year's completed quarters.* Circular:
Q1 is inside the average it is measured against.

### Department first, lines underneath

Three levels exist after the plan import — department (20), category (`budget_node` summaries), and
budget line (241). The view opens at department and expands to lines, matching the Grouped / Tree /
Flat control the budgets list already offers and the `TreeTable` the departments screen already
uses.

Their own sheet works at line level, so lines must be reachable; 241 rows × 4 quarters is not a
screen anyone reads top to bottom.

This one is a screen decision and may be revised while the screen is designed. It is recorded
because it was asked, not because it is settled harder than the three above.

### It reads `budget_txn.txn_date` and adds no column

`txn_date` is documented in the entity as the day of the event and explicitly not the insert time.
That is the whole mechanism. No period stamp is added to the ledger — which would be the quota
pattern, and which belongs to a change that gates on periods rather than reports on them.

The one thing a period stamp would buy even here is the release-attribution question below, and it
does not buy enough to justify writing a column onto an append-only ledger.

## Risks / Trade-offs

- **A closed quarter's figure moves when a release lands later** → the accepted cost of attributing
  a release to the quarter that committed it. Accepted knowingly: the budget department was asked
  and said the figures may move and the report is for internal use. It stops being acceptable the
  day a quarterly figure is sent outside the company, and the decision above records what to switch
  to if that happens.
- **A document straddling a quarter boundary is counted in the quarter it was approved** → which is
  what "counted at approval" means, and it will not match their spreadsheet for that document until
  it settles. The two measures agree over any complete lifecycle, and agree exactly for the whole
  imported 2026 history.
- **Reading four quarters per row costs four passes over the same ledger rows** → the figures come
  from one scan grouped by quarter, not four queries. Worth stating because the obvious
  implementation is a loop over quarters, and this report runs over a ledger that will hold every
  document the company ever raises.
- **The elapsed-window comparison needs the company's day, not the server's** → the same reason
  `budget_txn.txn_date` exists and `budgetUtilization` refuses to derive an overdue flag. "How much
  of this quarter has passed" is a question about the company's calendar, and the ledger service
  already resolves a company day (`companyDayFor`).

## Migration Plan

Not applicable — this change adds a read. It cannot be applied usefully, though, until the spend
history exists in the ledger, which is the note below.

## Open Questions

None blocking. The four that were open — what consumption means, where a straddling release lands,
what the first quarter compares against, and at what grain the view opens — were settled with the
budget department on the example recorded in the two decisions above.

Still worth asking before the screen is built:

- Whether a released commitment should be visible at all, or only the net figure. The gross-vs-net
  distinction is invisible in the current design.
- Whether `Σ ACTUAL` should appear as a second column. It was not needed to settle the definition,
  but the gap between the two measures is exactly the commitments outstanding at the boundary,
  which is information the department may want once they see it.

## A note for whoever builds the spend-history import

**The history must be imported per budget PER PERIOD, not one document per budget.**

The earlier direction — recorded in this conversation and nowhere else until now — was one opening
document per budget, 334 of them, each carrying a `RESERVE` and an `ACTUAL` for the accumulated
spend. That decision was made before anyone asked for a quarterly view, and it is incompatible
with one: a document has a single date, so 334 documents put 221,259,490,412 LAK into a single
quarter.

The cost of keeping the time dimension is small, and the data is already there — **every one of
the 5,714 spend rows carries a usable day, month and year**:

| grain | opening documents |
|---|---|
| one per budget | 334 — *loses every period* |
| one per budget per quarter | 652 |
| **one per budget per month** | **1,197** — matches how they track |
| one per budget per day | 2,555 |
| one per spend row | 5,714 |

Monthly is the recommendation: their monitoring sheet is kept by month and rolled to quarters, so a
monthly grain reproduces both views from one import, and costs 3.6× the documents of the choice
that throws the dimension away. A later change of mind from quarterly to monthly would mean
importing the whole history again.

**And it must create a zero budget wherever it finds spending with no budget to charge.**

Measured against what is actually in the database after the plan import:

| | codes | amount |
|---|---|---|
| spent against, and a budget exists | 194 | 188,603,340,581 |
| **spent against, and NO budget exists** | **125** | **32,700,999,830** — 14.8% |

The cause is the plan import's own rule, "money lives where the file puts money": a plan row with a
blank annual figure gets a `budget_node` and no `budget`. **110 of the 125 are exactly that** — a
line the plan left blank that they nevertheless spend on every month, `7.502 ເງິນເດືືອນ ພະນັກງານ
ພາຫະນະ` at 3,675,828,099 among them. Seven more are summary rows charged directly.

The rule was right about the plan and wrong about reality: spending against an unbudgeted line is
ordinary for them, at nearly a sixth of their expenditure.

So the history import creates a budget with `amount_total` of zero for every plan node it finds
spending against, and charges the spending to it. The result reproduces their own spreadsheet line
for line:

```
   spreadsheet   7.502   budget (blank)   used 3,675,828,099   remaining −3,675,828,099
   system        7.502   budget 0         used 3,675,828,099   remaining −3,675,828,099
```

*Alternative rejected — a zero budget for every leaf.* 212 more budgets, most of them for lines
nobody has ever spent on, to make the same 125 reachable.

*Alternative rejected — refuse and report.* 125 lines is not a list anyone will work through, and
until they do, 14.8% of the company's spending is missing from every figure the system states.

**This is not news to the customer.** Their sheet already shows 172 rows with a negative remaining
balance totalling −62,251,673,650. What the system adds is that the number survives being rolled
up — which theirs does not, since every department they roll into still reads positive.

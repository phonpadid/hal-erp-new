## Context

Two of the three things a year-end close does already exist. The third has never been built.

```
stop new documents in the year   fiscal_year.status = CLOSED        ✓ (document-engine reads it)
freeze the ledger by month       accounting_period                  ✓ (shipped two changes ago)
roll the result into equity      — nothing —                        ✗
```

The consequence is that revenue and expense accumulate without end. `financial-reports` compensates
by deriving retained earnings as *cumulative* net income, which is correct for a system with no
close and wrong for one that has months closed and none of them summed into anything.

What makes this small is that the reporting arithmetic does not have to change:

```
before a close       revenue 3 years deep · expense 3 years deep · derived RE = 3 years
after year 1 closes  year 1's rev/exp net to ZERO (the entry closed them)
                     year 1's result sits in an EQUITY account → picked up by equityTotal
                     derived RE = year 2 onward — which is exactly "current period"
```

The same expression means the right thing once the entry exists. That is worth noticing before
writing code to replace it.

## Goals / Non-Goals

**Goals:**

- A closed year's revenue and expense start the next year at zero.
- Its result sits in equity as a balance, not as a derivation.
- Forgetting to close the year is impossible.

**Non-Goals:**

- Reopening a closed year. Out of scope in the proposal, and deliberately not half-built here.
- An adjustment period. The right long-term shape, and a bigger idea than this.
- Opening balances for the new year. Balance-sheet accounts carry forward by not being closed,
  which is what makes them balance-sheet accounts.

## Decisions

### D1 — The year closes when its last period closes

The closing entry belongs on the year's last day. That day is inside the final period. So:

```
close(December)
  ① earlier periods closed?
  ② nothing owed?
  ③ accrual + its reversal
  ④ IS this the year's last period?  →  post the closing entry, dated 31 Dec
                                        flip fiscal_year to CLOSED
  ⑤ flip the period to CLOSED
```

Step ④ before step ⑤ is the whole point. Reverse them and `createEntry` refuses the entry for being
dated inside a closed period — correctly, because that is exactly what the guard exists to stop. The
alternatives were:

| option | verdict |
|---|---|
| a separate `closeYear` operation after all periods are closed | rejected: its entry is dated into a closed period, so it needs an escape hatch through the one guard this work spent a change building |
| date the closing entry the day after year end | rejected: puts the old year's result in the new year |
| an adjustment period that stays open | the real answer, and much bigger than this change |
| **post it while the final period is still open** | **chosen** |

It also removes a way to be wrong: a year cannot be left un-closed while its months are all closed,
because the two happen together.

The cost is that closing December does more than closing November, and the extra part cannot be
undone. Said plainly in the proposal's risks, and in the operation's own messages.

### D2 — The entry closes accounts by balance, not by transaction

```
for each REVENUE account with a non-zero balance in the year:  debit  its credit balance
for each EXPENSE account with a non-zero balance in the year:  credit its debit balance
the difference:                                                RETAINED_EARNINGS
```

Balances rather than a replay of every line: the year may hold a hundred thousand lines and three
dozen accounts, and the entry that zeroes them needs one line per account. Accounts with no activity
contribute nothing rather than a zero line.

The result lands in `RETAINED_EARNINGS` as a single figure. Splitting it by department or dimension
was considered and rejected: the balance sheet needs one number, and departmental results are a
report over the income statement rather than a posting.

### D3 — Keyed to the fiscal year

`(company, YEAR_CLOSE, fiscalYearId)` — the same uniqueness every other posting relies on, so a
retry or a re-entry into this path cannot post a second closing entry. It is also what makes the
step safe to run inside a period close that may itself be retried.

### D4 — The reports separate carried-forward from current, and change no arithmetic

`balanceSheet` computes `retainedEarnings` as the derived net income over everything up to `asOf`,
and adds it to `equityTotal` for the balance check. Both stay exactly as they are, because after a
close they already mean the right things: the closed year's revenue and expense net to zero, so the
derived figure covers only the open period, and the closed year's result is inside `equityTotal`
because it now lives in an equity account.

What changes is what the report *says*. It reports the equity account's own balance as brought
forward, beside the derived current-period figure, so a reader can tell "profit retained from prior
years" from "profit so far this year" — which the single number could never distinguish and which
was the actual complaint behind the Purpose sentence.

### D5 — No periods, no year close

A company that has declared no accounting periods has no final period, so nothing triggers a year
close and no closing entry is written. `FiscalYearService.close()` keeps setting the flag it always
set, which keeps blocking document submission and posts nothing — exactly its current behaviour.

This is the same rule every change in this sequence has followed, and it is what keeps the whole
body of work adoptable one company at a time.

## Risks / Trade-offs

**The largest entry the system will ever write.** Every revenue and expense account of a year, in
one document. A chart-of-accounts problem that has been quietly tolerable all year becomes visible
here, and the only correction is a reversal plus a voucher. That is the intended behaviour under
append-only and it will still be uncomfortable the first time somebody meets it.

**Closing December is irreversible in a way closing November is not.** A period reopens; a year does
not. The person performing the action is closing a month and may not be thinking about a year. The
operation names it, but a UI that does not repeat the warning will not have helped.

**The result is one figure.** A company wanting last year's profit by department will not find it in
equity, and will have to run an income statement bounded to that year — which still works, because
the entry does not delete anything. Worth stating because "we closed the year and lost the detail"
is the wrong conclusion available to somebody who only looks at the balance sheet.

## Migration Plan

An enum value, a seeded equity account and its role mapping. No table, no migration, no backfill:
years closed before this ships carry no closing entry, and manufacturing one would restate a result
somebody has already reported.

## Open Questions

- Whether a company should be prevented from closing its final period until it has mapped
  `RETAINED_EARNINGS`. It is, in effect — the entry cannot post without it and the close refuses,
  the same way the accrual refuses without `ACCRUED_EXPENSE`. Worth naming because the failure
  arrives at the end of a year rather than the end of a month, which is a worse time to discover a
  missing mapping.

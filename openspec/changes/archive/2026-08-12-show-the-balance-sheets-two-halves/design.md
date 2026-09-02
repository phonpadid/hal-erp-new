# Design

## D1. The brought-forward figure is displayed, never added

`balanceSheet` computes it by filtering the equity rows it already returned:

```ts
const broughtForward = retainedRole
  ? this.sum(equity.filter((r) => r.accountId === retainedRole.account.id))
  : '0';
```

So it is a **subset of `equityTotal`**, which is a term of `liabilitiesEquityTotal`. The current
period's `retainedEarnings` is the opposite: derived from revenue and expense, outside `equityTotal`,
and added as its own term.

Two numbers under one name with opposite arithmetic is how a reader lands on a total that is off by
the brought-forward amount. The screen therefore states the relationship rather than leaving it to be
inferred: the brought-forward line is marked as already included above, the current-period line is
not. Neither line participates in any sum the client computes, because the client computes none —
`liabilitiesEquityTotal` comes from the server.

Rejected: showing only the current-period figure (today's behaviour) — the reader sees a retained
earnings account in the table and a differently-valued "Retained earnings" line beneath it, and has
no way to tell they are different things. Also rejected: subtracting brought forward out of the
equity table to make the two lines disjoint — that edits the server's rows on the client, and the
account's balance is a real balance that belongs in the account listing.

## D2. Zero is shown, not hidden

A company that has never closed a year gets `0.00` on the brought-forward line. Hiding the line when
zero would make its later appearance look like a new number arriving from nowhere, and would make
"no year has been closed yet" indistinguishable from a screen that simply lacks the feature. The
figure is also `0` when `RETAINED_EARNINGS` is unmapped, which is a configuration fault the
accounting screens surface elsewhere; the balance sheet is not the place to diagnose it.

## D3. The note describes the split, not the absence of a close

The current note is a claim about system state — "no period close has rolled it into equity" — and
it was true only until the year-close change shipped. Replacing it with a state-dependent message
("a close has / has not happened") would put the same class of claim back, one refresh away from
being wrong again. The replacement describes the two figures instead, which is true in both states:
brought forward is what closed years put into equity and is already counted above; the current period
is what revenue and expense still stand at.

## D4. Three locales, translated not transliterated

`en`, `la` and `zh` hold identical key sets. `la` and `zh` already translate the accounting
vocabulary in this file (`ກຳໄລສະສົມ`, `留存收益`), so the new keys follow the terms already in use
rather than introducing English.

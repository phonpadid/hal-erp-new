# Design

## D1. Between the accrual and the year close, and neither side is arbitrary

`close()` runs: ① earlier periods closed, ② postings drained, ③ received-not-invoiced accrued,
④ year closed if this is the last period, ⑤ status flipped. Revaluation goes after ③ and before ④.

**After ②** because it reads the payable balances. A period with undelivered postings does not yet
have the balances it will have, so revaluing before the drain would retranslate a figure that is
about to change.

**Before ④** because `FX_GAIN` and `FX_LOSS` are profit and loss, and the year close sweeps revenue
and expense into retained earnings. A December revaluation posted after the year closed would sit
in a closed year's income statement, which nothing would then move.

**Before ⑤** for the reason ③ already gives: a failure leaves the period open rather than closed and
incomplete.

## D2. Only trade payables, and only foreign ones

Revalued: an open payable — an approval accrual crediting `ACCOUNTS_PAYABLE` with no payment against
it — whose document's currency is not the company's base currency.

Not revalued, each for its own reason:

- **`CLAIM_PAYABLE`** is owed to a person for expenses in the company's own money. There is no
  foreign amount to retranslate.
- **`ACCRUED_EXPENSE`** already posts with a reversal the day after the period. Revaluing it would
  retranslate an amount that is about to be unwound and recognised again from the invoice.
- **Payables in the base currency** have nothing to retranslate; including them would post a
  difference of zero for every domestic supplier and make the entry unreadable.

## D3. The reversal is posted with it, not left as an intention

`postForPayment` clears a payable **at the amount the accrual raised**, deliberately — the comment
says so, and it is what makes `payable + fx_delta = base_actual` balance by construction.

So a revaluation left standing would be stranded: the payment debits the original figure, and the
revaluation's share of `ACCOUNTS_PAYABLE` remains for good. Every foreign payment after a close
would leave a residue, and the account would drift away from the payables it represents.

The received-not-invoiced accrual already solved this shape, and its reasoning transfers exactly:

> A reversal that is a future intention is how the same expense gets recognised twice: the accrual
> stands in the closed month, the invoice arrives in the next, and nothing removes the first unless
> somebody remembers. Posting the pair together makes forgetting impossible rather than unlikely.

So: the revaluation dated the period end, its reversal dated the day after, both in one operation,
both keyed by the period so a re-close is a no-op.

The consequence is the same one that accrual accepts and states: the figure belongs to the close
that COMPUTED it. A reopen-and-reclose does not recompute, and a changed rate is corrected by
reversing and posting a voucher — which an operator can now do.

## D4. A missing closing rate refuses the close

The rate is `resolveRate({ from: documentCurrency, to: base, asOf: period.periodEnd })` — the
closing rate, not the rate on the day somebody ran the close.

`resolveRate` resolves the latest rate at or BEFORE that date, which is what a closing rate is: a
company does not publish a rate for every calendar day, and the rate in force at the period end is
the most recent one. It is not an exact-date lookup, and this change does not make it one.

When there is no rate for the pair at all, `resolveRate` throws — and that refusal is allowed to
propagate, so the close is refused naming the pair and the date.

The alternatives are worse in the same way. Falling back to the document's locked rate revalues
nothing while appearing to revalue. Falling back to the latest available rate reports a figure at a
date nobody chose. Skipping the payable silently understates the liability and says nothing. A
refusal is the only one of the four that leaves somebody able to act, and the codebase already
prefers that shape — the bank-file formatter refuses an unknown format rather than falling back,
because "silently sending the wrong layout to a bank is worse than not sending".

## D5. A liability that grows is a LOSS

Carried at 34,000 for 1,000 USD; the closing rate is 35. It now takes 35,000 to settle the same
debt, so:

```
Dr FX_LOSS               1,000
    Cr ACCOUNTS_PAYABLE  1,000
```

The intuition that a bigger number is better runs the wrong way for liabilities, and a sign error is
invisible in an entry that still balances — this work has hit that twice already, in the year close
and in the tax summary. So both directions are asserted separately: a rate that rose produces a
loss and a larger payable, a rate that fell produces a gain and a smaller one.

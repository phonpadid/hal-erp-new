# Design

## D1. The balance is shown while typing, and the submit waits for it

`createEntry` asserts the entry balances, so an unbalanced voucher is rejected. That makes the
server safe; it does not make the screen usable. An operator entering a twelve-line depreciation
voucher should see the two running totals converge, not discover a 0.02 discrepancy in a toast
after submitting.

Both totals go through `sumAmounts` (decimal.js), never a JS number — the same rule that applies to
every other amount in the app, and here it is load-bearing rather than cosmetic: `0.1 + 0.2` in
binary floating point is exactly the class of difference this screen exists to catch.

The client check is UX. The server still asserts, and a voucher that somehow arrives unbalanced is
still refused; the form does not get to decide what the ledger accepts.

Two conditions, not one: the totals must be **equal** and **non-zero**. A form full of zeroes
balances perfectly and would post an entry that says nothing.

## D2. The form sends an id, so a double-click cannot post twice

`PostJournalVoucherDto.id` is optional, and its comment sets the contract:

> Supply one and a retried request resolves to the same entry rather than a second one … Omit it and
> the request is not idempotent: a caller who did not ask for that protection does not get it.

A form submitted over a slow connection is precisely the caller who should ask. The alternative
protections are worse: disabling the button on submit loses to a page refresh, and a "did it post?"
check after the fact needs a query that can lie about a request still in flight.

So the view generates a `crypto.randomUUID()` when the form opens, sends it, and generates a new one
only after a successful post. Two submits of the same filled-in form are the same voucher; a fresh
voucher is a fresh id.

The consequence to keep in mind: after a **failed** post the id is deliberately kept, so correcting
a typo and resubmitting still cannot produce two entries — the failed attempt wrote nothing, and the
id is free.

## D3. The account field is a code, and the picker is the upgrade

`JournalVoucherLineDto.accountCode` is a free string resolved server-side by
`AccountService.resolvePostable`, which rejects an account that is missing, inactive, non-postable
or another company's. Listing accounts, by contrast, needs `COA_VIEW` — a code `GL_JV_POST` does not
imply.

This is the same shape as the fiscal-year gap on the periods screen, with a materially better
answer: the field can simply be typed. So the code input is always available and the picker is an
enhancement rendered when `COA_VIEW` is held. Nobody is blocked, and nobody is shown a selector that
cannot be filled.

The client does not validate the code beyond "not empty". Re-deriving postability here would put
that rule in two places and let them drift; the resolver's refusal names the account and the reason.

## D4. A reversal belongs on the row, not on a form

A voucher is composed; a reversal is chosen. Its lines are computed by the server from the original,
its only inputs are an optional date and memo, and the thing being reversed is a row the user is
already looking at. So it is a control on the journal list with a small dialog, and the voucher gets
the route.

Two things the dialog says, because both surprise:

- **A reversal is dated today, not the original's date.** The DTO's comment gives the reason: the
  original's period is frequently closed — often why it is being reversed — and dating a correction
  into a reported month would either be refused or restate figures people acted on. The date field
  is offered, defaulted to empty, meaning today.
- **An entry can be reversed at most once.** The server checks and the unique index backs it. A
  second attempt is refused with a message naming the reversing entry; the screen shows it as
  returned rather than pre-checking, which would need the reversal list and could still race.

Any entry may be reversed, not only a manual one — a wrong automatic posting is the likelier case.
The control is therefore on every row, not only on `MANUAL_JV` ones.

## D5. `entryTotal` moves onto `sumAmounts` rather than being left alone

`JournalView` computes an entry's total as `Math.round(Number(l.debit) * 100)` — money through a JS
number, contrary to the rule the rest of the app follows.

Normally an unrelated defect is left to its own change. It is fixed here because this change adds
the correct arithmetic to the same screen's neighbourhood: leaving the two side by side would make
the wrong one look like a considered alternative, and the correct helper is one call. `sumAmounts`
already exists and is already tested.

# Design

## D1. The clearing account earns its name

`CASH_CLEARING` already sits on the credit side of every payment. Nothing about the posting engine
changes: what changes is what the role points at, and that a second entry now clears it.

This is why the change is smaller than it looks. The engine was written with a clearing account in
mind — the role is called `CASH_CLEARING`, not `CASH` — and only the seed's mapping made it behave
as cash. The second step was the missing half, not a redesign.

**The clearing balance is the reconciling item.** After this, "what have we paid that the bank has
not confirmed" is the balance of one account, not a query somebody has to write. That property is
the reason to prefer the two-step over stamping a `cleared_at` on the payment and reporting off it:
a flag would leave the ledger saying the money is gone while the bank has not moved it.

## D2. A bank account names its GL account rather than being one

`bank_account` carries the company's account details — bank, number, currency — and a foreign key
to the `account` whose balance represents it.

Not the other way round, and not one row serving both. The chart of accounts is configuration a
company already owns and may already have populated; a bank account is a fact about the outside
world. Making the GL account a property of the bank account lets two bank accounts share nothing,
or, if a company wants it, share one GL account deliberately.

The clearing account stays single and role-mapped. Payments in flight are payments in flight
whichever account they will leave; splitting the clearing account per bank would multiply the thing
being reconciled without telling anybody more.

## D3. Confirmation is per payment, and dated by the bank

The confirmation names a payment, a date, and nothing else. The date is the bank's — the day the
money actually left — because that is the date the reconciliation is against, and it is routinely
not the day finance recorded the payment.

The entry is keyed `(company, BANK_CLEARED, paymentId)`, so a confirmation delivered twice resolves
to the entry already written, like every other posting in this system.

**Rejected: confirming a whole batch at once.** A batch is a file sent to a bank; the bank's result
is already imported per line, and lines fail individually. Confirming at batch level would either
lose that granularity or invent a rule about what a partially-cleared batch means.

## D4. No re-mapping of a live `CASH_CLEARING`

The seed gets the two-step shape. An existing company does not.

`account_role` is configuration, and re-pointing `CASH_CLEARING` at a new account in a migration
would move every historical payment's credit to an account those payments never touched — silently,
in a data migration, for balances somebody has already reported on.

So existing companies keep `CASH_CLEARING → 1000 Cash` and behave exactly as before: payments credit
it, nothing confirms, and the reconciliation read reports everything as unconfirmed. Adopting the
new shape means creating a clearing account, moving the balance with a journal voucher, and
re-pointing the role — three deliberate acts, each visible, none of them done by a migration behind
somebody's back.

Stated in the proposal rather than buried here, because a company that upgrades and sees no change
should know why.

## D5. The reconciliation read is derived, like the payables one

Per bank account: the GL balance of its account, the payments not yet confirmed, and their total.
All from the journal and the payment rows, not from a stored reconciliation record.

Same reasoning as `openPayables`: a derived read cannot drift from the journal because it is read
from it. A stored "reconciliation" row would be a second opinion about the same facts, and the two
would eventually disagree.

## D6. Unattributed payments are reported, and this was found by a test

`payment.bank_account_id` is nullable (D4), so a payment can credit the clearing account and belong
to no bank account's reconciliation. Every payment recorded before this change is in that state.

The first version of the "outstanding equals the clearing balance" test was 3,000 out, and the 3,000
was exactly such a payment. The property is not true per bank account — it is true across the bank
accounts **plus** the unattributed.

So there is a second read for them. The alternative, quietly excluding them, would leave a clearing
account that can never reconcile to zero with nothing on any screen explaining why — which is worse
than the gap it hides. Attributing one is a deliberate act: somebody has to know which account the
money left.

# Reconcile the bank

## Why

The company's cash is unauditable. Three facts, and each makes the next worse:

**`CASH_CLEARING` is not a clearing account.** The role is named for one and the seed maps it
straight to `1000 Cash`. So a payment credits Cash the moment finance records it, whether or not the
money has left the bank.

**Nothing records which bank account paid.** `vendor_bank_account` is the payee's. There is no table
for the company's own accounts at all, so a payment cannot say where the money came from, and a
company with two bank accounts has one indistinguishable Cash balance.

**So there is nothing to reconcile against.** Bank reconciliation is the comparison of what the
books say left with what the bank says left, and this system records only the first — with no
account to attribute it to and no state between "recorded" and "gone".

The standard shape is two steps, and the system already has the first:

```
payment recorded    Dr payable        Cr cash clearing   ← committed to leave
bank confirms       Dr cash clearing  Cr bank account    ← actually left
```

The clearing account's balance is then exactly the payments in flight — the reconciling item every
bank reconciliation starts from. It falls out of the structure rather than needing a statement
import to compute.

## What Changes

- `bank_account`: the company's own accounts, each naming the GL account its balance lives in.
- `payment.bank_account_id` — where the money left from, stamped when the payment is recorded and
  defaulted from its batch.
- A **confirm-cleared** operation: the bank says the money left on a date, and the system posts
  `Dr CASH_CLEARING / Cr` that bank account's GL account for it.
- A reconciliation read per bank account: the confirmed balance, the payments still in flight, and
  their total — which is the clearing balance, from the same rows.
- The seed maps `CASH_CLEARING` to a new `1010 Cash Clearing` and gives `1000 Cash` to a seeded bank
  account, so a fresh company gets the two-step shape.

## What This Change Does NOT Do

- **No bank statement import or automatic matching.** Confirmation is recorded per payment, from
  whatever the bank told finance. Parsing statement formats is a capability of its own, and the
  reconciliation it would speed up works without it.
- **No re-mapping of an existing company's `CASH_CLEARING`.** Changing where a live role points
  moves real balances. Existing companies keep the mapping they have; adopting the two-step shape
  is a deliberate act with a manual journal voucher behind it. See design D4.
- No multi-currency bank accounts beyond what the payment already carries. A bank account names a
  currency; converting is the payment's job and it already does it.

## Impact

- Affected specs: `gl-journal`, `payment-handoff`
- Affected code: new entity + migration + DBML, a bank-account service and controller,
  `gl-posting.service.ts` for the clearing entry, `payment` entity and its recording path, seed;
  frontend api/store/view, i18n, smoke.
- Migration: one new table and one nullable column. No data moved.

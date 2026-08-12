# Say which account the batch paid from

## Why

Bank reconciliation shipped with a hole it named: a payment batch does not record which of the
company's accounts the file was sent from, so every payment a batch creates carries no bank account
and lands in the "unattributed" list — visible, but unreconcilable until somebody attributes it by
hand.

That is the normal path, not the exception. A batch IS a file sent to one bank from one account;
the account is a property of the run, and the run already carries its format, its pay date and the
bytes that were sent.

The bank accounts themselves also have no screen. The endpoints exist and are permission-gated;
creating one means a POST by hand, which is not a way to configure the account a company's cash
balance lives in.

## What Changes

- `payment_batch.bank_account_id`, set when a batch is built.
- Importing a batch's result stamps it onto every payment the import records, in the same place the
  batch itself is already stamped.
- A bank-accounts screen: list, create against a GL account, deactivate.

## What This Change Does NOT Do

- **No back-filling of existing payments.** A payment recorded before this has no bank account and
  gets no guessed one; it stays in the unattributed read, which is what that read is for.
- No requirement that a batch name an account. A company that has not configured its bank accounts
  yet must still be able to pay; those batches behave exactly as they do today.
- No change to the reconciliation itself.

## Impact

- Affected specs: `payment-batch`, `web-payments`
- Affected code: `payment.entities.ts`, `payment-batch.service.ts`, its DTO, a migration; frontend
  api/store/view, i18n, smoke.
- Migration: one nullable column.

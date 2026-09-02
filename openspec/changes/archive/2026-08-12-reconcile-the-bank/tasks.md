## 1. The bank account

- [x] 1.1 `BankAccount`: company, name, bank name, account no, currency, GL `account`, `isActive`.
- [x] 1.2 DBML, with the note on why it names a GL account rather than being one.
- [x] 1.3 `Migration20260820000000` creates it and adds `payment.bank_account_id`, nullable.
- [x] 1.4 `BANK_ACCOUNT_VIEW` / `BANK_ACCOUNT_MANAGE`.

## 2. Recording where the money left from

- [x] 2.1 `payment.bankAccount`, nullable.
- [x] 2.2 NOT done: stamping it from the batch. The batch has no bank account of its own yet, and
      adding one is a second column plus a change to the export/import path — out of this change's
      shape, which is the ledger side. Recording a payment with a bank account works; batches leave
      it null, and those payments appear in the unattributed read rather than vanishing (D6).
- [x] 2.3 A payment recorded with a bank account carries it.

## 3. Confirming

- [x] 3.1 `confirmCleared` posts `Dr CASH_CLEARING / Cr` the bank account's GL account, on the
      BANK's date, keyed `(company, BANK_CLEARED, paymentId)`.
- [x] 3.2 `SOURCE_BANK_CLEARED` added.
- [x] 3.3 Refused with no bank account; a second confirmation resolves to the first entry and does
      NOT re-date it.
- [x] 3.4 Per payment, not per batch.
- [x] 3.5 The amount is the base actual NET OF WITHHOLDING — the same figure the payment credited to
      the clearing account, or the account would never reach zero.

## 4. The reconciliation read

- [x] 4.1 Per bank account: unconfirmed payments and their total, derived.
- [x] 4.2 The GL balance of the bank account's account alongside.
- [x] 4.3 Under `BANK_ACCOUNT_VIEW`.
- [x] 4.4 Not in the plan: `unattributed()`. See task 7.4 — a test found that the invariant does not
      hold without it.

## 5. Seed

- [x] 5.1 `1010 Cash Clearing`; `CASH_CLEARING` maps to it.
- [x] 5.2 `1000 Cash` stays as the account a seeded bank account would name.
- [x] 5.3 No migration re-maps an existing company's role.

## 6. The client

- [x] 6.1 api + store + `BankReconciliationView` with the account picker, the ledger balance, what
      is in flight, and the unattributed panel.
- [x] 6.2 Amounts through `fmtBase`; nav entry; i18n in three locales; smoke registry.
- [x] 6.3 NOT done: a bank-accounts management screen. The endpoints exist and are permission-gated;
      the reconciliation is what makes the change useful, and a CRUD screen for four fields is
      separable. Stated rather than implied.

## 7. Tests

- [x] 7.1 Confirming posts the clearing entry on the bank's day.
- [x] 7.2 Confirming twice posts once, and does not re-date.
- [x] 7.3 A payment with no bank account cannot be confirmed.
- [x] 7.4 The clearing balance is accounted for.
      The first version asserted the per-account outstanding alone and was 3,000 out. The 3,000 was
      the payment naming no bank account: it credits the clearing account and belongs to no
      reconciliation. The property is true across the bank accounts PLUS the unattributed — which is
      why `unattributed()` exists. Design D6 records this.
      An earlier version was further wrong: the fixture created `Payment` rows without the credit
      the payment path writes, so the clearing account only ever had debits and the assertion could
      not mean anything. The fixture now writes both sides.
- [x] 7.5 A confirmed payment drops off.
- [x] 7.6 A bank account naming another company's GL account is refused.
- [x] 7.7 Ten existing `gl-posting.service.spec.ts` assertions pinned the payment credit landing on
      `1000`. They now name `1010` through a constant with a comment: a payment crediting the
      CLEARING account rather than Cash is the change, not a detail.
- [x] 7.8 Negative check: the confirm control without its permission, the unattributed panel hidden,
      and confirming without the bank's date each redden their case.

## 8. Checks

- [x] 8.1 Backend 1443 passed / 36 skipped; frontend 91 files / 796 tests; `nest build` and
      `typecheck` clean.
- [x] 8.2 `npm run migration:up` applied `Migration20260820000000` against the real database.
- [x] 8.3 `openspec validate --all` passes.
- [x] 8.4 `openspec/specs/**` untouched.

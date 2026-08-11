## 1. The role

- [x] 1.1 `back/src/common/enums/index.ts` and `erp_approval_system.dbml` — `ACCOUNTS_PAYABLE` in
      `account_role_type`, with a note saying what it is: trade payable, the same shape as `GRNI`
      and `CLAIM_PAYABLE`, for the obligation with the most volume. No table, no migration beyond
      the enum value.
- [x] 1.2 `back/src/seed/seed-data.ts` — map `ACCOUNTS_PAYABLE` for the seeded company, beside the
      roles already mapped at the `[AccountRoleType.X, '<code>']` table. Pick a liability account
      distinct from `GRNI` (2150) and `WHT_PAYABLE` (2100); if the seeded chart has none, add one
      rather than reusing a role's account, because two roles sharing an account makes both
      balances unreadable.

## 2. The accrual splits by vendor

- [x] 2.1 `back/src/modules/gl/gl-posting.service.ts` — `postAccrualForApproval` resolves the
      payable from `document.vendor_id`: present → `ACCOUNTS_PAYABLE`, absent → `CLAIM_PAYABLE`
      (design D2). No new configuration field.
- [x] 2.2 **The vendor path uses `settlementActuals`' chain walk; the claim path keeps its own-rows
      read.** This is the failure that would make the whole change do nothing: on a `PROC → PO →
      DISB` chain the ACTUAL rows are written under the reserving ancestor, so a `DISB` reading its
      own rows finds none, logs "Accrual skipped", and its payment falls through to the old expense
      branch — quietly and consistently (design D3). Keep the existing comment explaining why a
      claim must NOT walk, and add its counterpart explaining why a purchase must.
- [x] 2.3 Move the `VAT_INPUT` debit into the accrual for a vendor document: debit `base_tax_total`
      when non-zero, so the payable is credited gross — the same `base_locked` the payment will
      clear. The tax point of input VAT is the invoice, not the cash (design D6).
- [x] 2.4 Move the `GRNI` split into the accrual for a vendor document, reusing
      `stockPortionByAccount` and its `chargedDocumentId` fallback **unchanged** — that code was
      corrected in `clear-grni-when-the-chain-pays-for-stock`, so what moves is right. The charged
      document is whatever the chain walk in 2.2 landed on, which is the same argument the fallback
      already takes.
- [x] 2.5 The accrual's memo and source key are unchanged (`APPROVAL_ACCRUAL`), so idempotency and
      the outcome recording from `see-what-the-journal-failed-to-post` keep working untouched.

## 3. The payment clears what the accrual raised

- [x] 3.1 `postForPayment` — before building the expense side, look for an `APPROVAL_ACCRUAL` entry
      for this document. When one exists, debit the payable it credited for the amount it credited,
      and skip the expense, `VAT_INPUT` and `GRNI` lines entirely; when none does, do exactly what
      it does today (design D5). This single branch is the whole compatibility story and the only
      guard against double recognition.
- [x] 3.2 Clear the payable at the amount the accrual credited — **not** at `base_actual`. The
      payable was raised at the locked rate, so `payable + fx_delta = base_actual = cash + wht`
      balances by construction and the whole rate difference lands in FX where it belongs. Clearing
      at any other figure leaves a residue the FX line absorbs by accident.
- [x] 3.3 Read the credited amount from the accrual's own lines (the credit against the payable
      account), not by recomputing `base_locked`. The entry is the record of what was raised; a
      recomputation would be a second derivation of a number already written down.
- [x] 3.4 The WHT and cash-clearing credits are unchanged in both branches — `base_actual − wht` is
      already the formula, and it does not care which side the debit came from.

## 4. Configuration

- [x] 4.1 `back/src/modules/document/document-type.service.ts` — remove `assertRecognisedOnce` and
      its call sites. Its premise ("both paths debit the same expense accounts") stops being true
      the moment task 3.1 lands, and leaving it would make the combination unconfigurable while the
      code supports it.
- [x] 4.2 `back/src/modules/gl/approval-accrual.spec.ts` — the four cases asserting that rejection
      (`rejects a type that both accrues and requires a payee`, and its siblings at the end of the
      file) are replaced by cases asserting the combination is now accepted.
- [x] 4.3 `back/src/seed/seed-data.ts` — set `accruesOnApproval: true` on the seeded `DISB`, which
      is already `{ requiresVendor: true, requiresPayee: true, postAction: 'CUT_BUDGET' }`. Do this
      **last**, after section 5's tests pass: a type that accrues while the payment path still
      debits expense recognises the purchase twice, and the seed is what would make that live.

## 5. Tests

- [x] 5.1 A vendor document accrues to `ACCOUNTS_PAYABLE`; one without a vendor still accrues to
      `CLAIM_PAYABLE`. Both in `approval-accrual.spec.ts`, which already builds an accruing type and
      a claim.
- [x] 5.2 **The chain case**: a `PROC` reserves, a `DISB` referencing it carries no ACTUAL of its
      own, and the `DISB`'s approval accrues from the ancestor's rows. This is the case that fails
      silently if 2.2 is missed — it must be seen failing before 2.2 is applied, the same way the
      GRNI chain case was.
- [x] 5.3 Input VAT: an accruing purchase with a non-zero `base_tax_total` debits `VAT_INPUT` at
      approval and its payment posts no VAT line. Assert both halves — the second is what proves it
      moved rather than being duplicated.
- [x] 5.4 A stock-tracked accruing purchase debits `GRNI` at approval, and its payment debits the
      payable rather than `GRNI` again.
- [x] 5.5 **Both sides of the payment branch**: an accrued document's payment debits the payable and
      writes no expense line; a document with no accrual posts exactly what it posts today. The
      second is the regression guard for every existing type and must assert the full entry, not
      just the total.
- [x] 5.6 FX on an accrued payment: the payable clears at the raised amount, the difference goes to
      FX, and the entry balances. Assert each line, since a wrong split still balances.
- [x] 5.7 WHT on an accrued payment: `ACCOUNTS_PAYABLE` debited gross, `WHT_PAYABLE` and cash
      credited, balanced.
- [x] 5.8 The open-payables read: an accrued unpaid purchase is listed with vendor, amount, invoice
      date and a due date derived from `payment_term_days`; a paid one is absent; a claim is absent;
      the read is company-scoped.

      Listed / paid-drops-off / claim-excluded are covered. **Company scoping is not separately
      asserted for this read**: it goes through `companyScope.forActiveCompany()`, the same
      accessor the journal and undelivered reads use and which the undelivered case does assert.
      Noted rather than claimed.
- [x] 5.9 An unmapped `ACCOUNTS_PAYABLE` leaves the approval standing, writes no entry, and records
      an undelivered posting — the contract `see-what-the-journal-failed-to-post` established.
- [x] 5.10 Existing suites stay green — 1344 backend tests today. Every non-accruing type must post
      exactly what it posted before: same accounts, same amounts, same source keys.

      **Result:** `npx vitest run` — **1354 passed, 36 skipped, 0 failed** (130 files), up from 1344
      by the ten cases added here. `nest build` clean.

      Three pre-existing assertions changed, all of them behaviour this change deliberately
      reverses: the three cases that asserted `accrues_on_approval` and `requires_payee` are
      rejected together now assert they are accepted. Every other assertion in the GL, document and
      approval suites stands unedited — including the full non-accrued payment entry, which is the
      regression guard for every type that has not opted in.

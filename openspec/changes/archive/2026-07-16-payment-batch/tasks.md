## 1. Data model

- [x] 1.1 Update `erp_approval_system.dbml` with `vendor_bank_account`, `payment_batch`, `payment_batch_line`, plus `document_type.requires_payee` (bool, default false), `document.vendor_bank_account_id`, and `payment.batch_id` (the last two nullable)
- [x] 1.2 Correct the stale `document_type.post_action` note in the DBML while there: drop `CREATE_PO`, add `CREATE_SUCCESSOR`, `ADJUST_INCREASE`, `ADJUST_DECREASE`, `TRANSFER`
- [x] 1.3 Add the `VendorBankAccount` entity to `back/src/modules/master-data/master-data.entities.ts` — `ManyToOne` to the group-level `Vendor` (extends `BaseEntity`, **not** `CompanyScopedEntity`), money-free, `account_no` as text, `@Unique` on `(vendor, bankCode, accountNo)`
- [x] 1.4 Add `PaymentBatch` + `PaymentBatchLine` entities under `back/src/modules/payment-handoff/` — both `CompanyScopedEntity`; line amounts as `type: 'decimal'` carried as string
- [x] 1.5 Add `requiresPayee` to the `DocumentType` entity (default `false`), `vendorBankAccount` to `Document`, and `batch` to `Payment` (the last two nullable)
- [x] 1.6 Write the additive migration and verify it applies to a seeded DB with no backfill

## 2. Vendor bank accounts

- [x] 2.1 Register the `VENDOR_BANK_MANAGE` permission code and seed it onto the roles already holding `PAYMENT_MANAGE`
- [x] 2.2 Implement `VendorBankAccountService` — create, update, deactivate, and set-primary, with the primary demotion in one `em.transactional()`
- [x] 2.3 Enforce the duplicate `(vendor, bankCode, accountNo)` rule with a 409, mirroring `DeptDocTypeService`'s existing conflict style
- [x] 2.4 Record actor, timestamp, and before/after `bank_code`/`account_no`/`account_name` on every mutation
- [x] 2.5 Expose the controller — reads on `VENDOR_VIEW`, every mutation on `VENDOR_BANK_MANAGE`, `ParseUUIDPipe` on params
- [x] 2.6 Unit tests: many accounts per vendor, atomic primary swap, duplicate rejected, `VENDOR_MANAGE` alone cannot mutate, group-wide visibility

## 3. Payee on the disbursement

- [x] 3.1 Accept and persist `requiresPayee` in `DocumentTypeService.create`/`update` and its DTOs, defaulting to `false`, and expose it on the config read surface
- [x] 3.2 Accept `vendorBankAccountId` in the create/update document DTOs, validated with `class-validator`
- [x] 3.3 Reject any change to `vendor_bank_account_id` once the document has left `DRAFT`
- [x] 3.4 Add the submit gate in `DocumentSubmitService` beside the existing `requiresVendor` check — required when `docType.requiresPayee`, **never** branching on `post_action` (the seeded `PR` carries `CUT_BUDGET` and has no payee); account must belong to the document's vendor and be active, **placed before any budget or quota hold** so a rejected submit leaves `DRAFT` clean
- [x] 3.5 Set `requiresPayee: true` on the seeded `DISB` type and confirm `PR` is left `false`
- [x] 3.6 Unit tests: missing payee rejected with nothing reserved, wrong-vendor account rejected, inactive account rejected, **a `CUT_BUDGET` type with `requiresPayee` false submits unaffected (the PR regression)**, payee immutable in `IN_APPROVAL` and after `COMPLETED`, editable again after return-to-draft

## 4. Batch build and the queue

- [x] 4.1 Register `PAYMENT_BATCH_VIEW` and `PAYMENT_BATCH_MANAGE` and seed them alongside `PAYMENT_MANAGE`
- [x] 4.2 Extend `PaymentHandoffService.readyToPay` to also subtract documents held by a `DRAFT` or `EXPORTED` batch, and to return the payee bank account
- [x] 4.3 Implement `PaymentBatchService.build` — validate every document is payable in the active company, snapshot payee and amount onto each line, start at `DRAFT`
- [x] 4.4 Implement cancel — `DRAFT`/`EXPORTED` only, leaves existing payments untouched, `COMPLETED` refused
- [x] 4.5 Unit tests: snapshot survives a later account edit, non-payable rejected, cross-company rejected, batched document leaves the queue, cancelled batch's document returns, no `budget_txn` or `quota_usage` written by any of it

## 5. Export

- [x] 5.1 Define the `BankFileFormatter` interface and a registry keyed by the batch's `format`; reject an unknown format rather than defaulting
- [x] 5.2 Implement `CsvBankFileFormatter` — no new npm dependency; amounts formatted from the decimal string using the currency's `decimal_places`, never via a JS number
- [x] 5.3 Add the `payment-batches/{batchId}/` key layout to `StorageService`
- [x] 5.4 Implement export — render, store the bytes, record the key, move `DRAFT` → `EXPORTED`, freeze lines; net the line by `wht_amount` where a tax code is set
- [x] 5.5 Make re-export return the stored bytes instead of re-rendering
- [x] 5.6 Reject export when a line's payee account is no longer active, naming the document and account, with **no** fallback to the primary account
- [x] 5.7 Unit tests: export freezes the batch, WHT nets the exported amount, re-download is byte-identical, deactivated payee blocks export and the batch stays `DRAFT`, unknown format rejected

## 6. Result import

- [x] 6.1 Implement the CSV result parser; an unparseable file aborts the whole import
- [x] 6.2 Implement `PaymentBatchService.importResult` — `LockMode.PESSIMISTIC_WRITE` on the `payment_batch` row, then one `em.transactional()` over every line
- [x] 6.3 For each succeeded line call the existing `PaymentService` with the per-line actual rate and `wht_tax_code_id`, and set `payment.batch_id`; record the bank's reason on each failed line; resolve to `COMPLETED` or `PARTIAL`
- [x] 6.4 Treat a line whose document already has a `payment` as a reported no-op, leaning on the unique constraint rather than a status check
- [x] 6.5 Gate on `EXPORTED` — importing against a `DRAFT` batch is refused
- [x] 6.6 **Concurrency test:** two simultaneous result uploads for one batch serialize on the pessimistic lock and produce exactly one payment per document
- [x] 6.7 Unit tests: full success completes, one rejection yields `PARTIAL` and the document returns to the queue, malformed file changes nothing, re-upload pays once, FX delta matches the single-document path, **no `budget_txn` written at any actual rate**

## 7. Controllers

- [x] 7.1 Add the batch controller — `GET` list/detail on `PAYMENT_BATCH_VIEW`; build, export, import, cancel on `PAYMENT_BATCH_MANAGE`; `ParseUUIDPipe` on every UUID param
- [x] 7.2 Apply company scope on every route so another company's batch is indistinguishable from a missing one
- [x] 7.3 Wire the modules and confirm `payment.ready` and `payment.settled` still fire unchanged

## 8. Frontend

- [x] 8.1 Add the payee selector to the document form — only when the type's `requiresPayee` is true, disabled until a vendor is picked, cleared on vendor change, primary preselected, account number rendered as text
- [x] 8.1a Add the `requiresPayee` toggle to the doc-type admin form (`DocTypesView`) alongside the existing `requiresBudget`/`requiresVendor` toggles
- [x] 8.2 Mirror the payee rule in the form's Zod schema so the client fails the same submit the server would
- [x] 8.3 Show the payee (bank, account name, account number) on the document detail for approvers
- [x] 8.4 Build the batch views — build-from-queue with per-line WHT, export/download, result upload with rates prefilled from each document's locked rate, per-line outcomes, cancel with an explicit warning on `EXPORTED`
- [x] 8.5 Add the batch list with status, line count, total, age, and a visual flag on a stalled `EXPORTED` batch
- [x] 8.6 Gate every affordance by permission code from the active-company Pinia context; style with PrimeUI tokens only, no hardcoded colors
- [x] 8.7 Component tests: selector visibility driven by `requiresPayee`, vendor change clears the payee, client-side required error, permission-gated affordances, stalled-batch flag

## 9. Ship

- [x] 9.1 Seed `vendor_bank_account` rows for the seeded vendors so the demo data can still submit a DISB
- [x] 9.2 Run the full backend and frontend suites; **verify failures against pristine HEAD before blaming this diff** — profile, approval-inbox, multi-company, and `seedDatabase` specs are known to fail on HEAD
- [ ] 9.3 Deploy with `requires_payee` off everywhere, then turn it on per type once that type's vendors have accounts — the flag defaults false, so the gate is inert on deploy and each company opts in when its data is ready, rather than every in-flight disbursement breaking at once

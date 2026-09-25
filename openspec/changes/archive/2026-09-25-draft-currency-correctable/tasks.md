## 1. Server — accept the correction

- [x] 1.1 Add `currency?: string` to `SetSelectionsDto` in
      `back/src/modules/document/dto/document.dto.ts`, validated `@IsOptional() @IsString()
      @Length(3, 3)` to match `CreateDocumentDto.currency`, with a comment saying why it is a code
      and not a `...Id` like its neighbours.
- [x] 1.2 In `DocumentService.setSelections`, resolve the currency in the same
      resolve-everything-before-assigning block as the other selections: reject an explicit null
      (`BadRequestException`), resolve the code through `requireCurrency`, and reject a `currency`
      that is not active. Assign only after every other supplied value has passed.
- [x] 1.3 Confirm no migration and no entity change is needed — the DBML column is
      `document.currency` (a `varchar(3)` ISO code, not a `currency_id` FK), it is nullable, and
      `Document.currency` is already mapped to it via `@ManyToOne(fieldName: 'currency')`.

## 2. Server — tests

- [x] 2.1 Unit test: a `DRAFT` document's currency is corrected; the line amounts, `exchange_rate`
      and stored totals are untouched.
- [x] 2.2 Unit test: the change is refused in `IN_APPROVAL` and in `COMPLETED`, and the document is
      unchanged (extend `selections-correctable.spec.ts`, which already covers the other selections).
- [x] 2.3 Unit test: an unknown code, an inactive `currency`, and an explicit null are each refused
      and leave the document unchanged.
- [x] 2.4 Unit test: one request carrying a valid `warehouseId` and a bad currency writes neither —
      the all-or-nothing property the route already promises.
- [x] 2.5 Unit test: a draft returned to `DRAFT`, corrected and resubmitted resolves its rate at that
      submit from the new currency (invariant 6 — the rate is stamped at submit, not at correction).
- [x] 2.6 Confirm no concurrency test is owed: this path writes neither `budget_txn` nor
      `quota_usage`, issues no document number, and takes no lock.

## 3. Client — send it

- [x] 3.1 Add `currency?: string` to `DocumentSelections` in `front-end/src/api/documents.ts`.
- [x] 3.2 In `CreateDocumentView.vue`, build the edit branch's `selections` payload from the
      `headerFields` list (filtered to the keys the selections route accepts) instead of the
      hand-written literal, so create and edit cannot drift again — the drift this change exists to
      fix, and the one the list's own comment warns about.
- [x] 3.3 Disable the currency picker once the document has left `DRAFT`, alongside the other
      selection pickers (`selectionsLocked`).

## 4. Client — tests

- [x] 4.1 Component test: reopening a draft, changing the currency and saving sends the chosen
      currency in the selections request.
- [x] 4.2 Component test: a refused save surfaces the error and shows no success confirmation.
- [x] 4.3 Component test: the currency picker is disabled for a document that has left `DRAFT`.
- [x] 4.4 Regression test: the create path still sends the currency (the `headerFields` refactor
      touches the payload both paths build).

## 5. Verify against the real case

- [x] 5.1 With the dev stack up, correct `REC-HAL-2026-0026` from LAK to THB through the GUI as its
      author, reload, and confirm the API reports `currency: "THB"`. Done — but only after finding
      that `front-end/.env` set `VITE_API_URL` to the PRODUCTION origin, so every GUI save from
      localhost was reaching `erp.hal-logistics.la` while the verification read went to the local
      API. The override is commented out; the dev app is origin-relative again.
- [x] 5.2 Confirm the documents list and the detail screen show the document in THB, and note (do
      not fix here) that `base_total_amount` stays as last stamped until the document is resubmitted.
      Detail shows `42,000.00 THB` (two decimals, per THB's `decimal_places`); the base-currency
      tile and the list column both still read `42,000 LAK` and the rate tile `1.00`, exactly the
      staleness the design's Risks section names. Not resubmitted — that is the requester's call.
- [x] 5.3 Run the `back/` unit suite and the `front-end/` unit suite.

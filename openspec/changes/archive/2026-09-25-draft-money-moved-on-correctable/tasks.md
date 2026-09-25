## 1. Server — the route and its guards

- [x] 1.1 Add `SetMoneyMovedOnDto` to `back/src/modules/document/dto/document.dto.ts` —
      `moneyMovedOn?: string | null`, `@IsOptional() @IsDateString()`, nullable on purpose, with a
      comment saying why clearing is allowed here and was not for the currency.
- [x] 1.2 Add `DocumentService.setMoneyMovedOn`: `DRAFT`-only, load the document's `documentType`
      and its company's `timezone` explicitly (`getWith` populates no relations), and reuse the
      existing `assertMayStateTheDay` for a stated day rather than restating its three checks.
- [x] 1.3 Skip the guard entirely when clearing — there is no future day to refuse and no past day to
      backdate, and requiring `DOC_BACKDATE` to remove a date would strand the drafts of a type that
      has lost `records_past_events`.
- [x] 1.4 Add `PATCH :id/money-moved-on` to `document.controller.ts`, `@RequirePermissions(DOC_CREATE)`,
      `@HttpCode(204)`, with a comment on why it is its own route and not part of `:id/selections`.

## 2. Server — tests

- [x] 2.1 Unit test: a draft's day is corrected by a caller holding `DOC_BACKDATE`.
- [x] 2.2 Unit test: the corrected day becomes the `txn_date` of the `budget_txn` rows written at
      submit — the reason the column matters at all.
- [x] 2.3 Unit test: refused in `IN_APPROVAL` and `COMPLETED`, document unchanged, no ledger row
      altered.
- [x] 2.4 Unit test: refused for a type without `records_past_events`; refused for a future day.
- [x] 2.5 Unit test: a past day without `DOC_BACKDATE` is refused with a forbidden error.
- [x] 2.6 Unit test: clearing succeeds WITHOUT `DOC_BACKDATE`.
- [x] 2.7 Confirm no concurrency test is owed: the path writes no `budget_txn`/`quota_usage` and
      takes no lock; note in the test file that submit remains the only writer of the rows this
      column dates.

## 3. Client

- [x] 3.1 Add `MoneyMovedOnInput` and a `setMoneyMovedOn` wrapper to `front-end/src/api/documents.ts`.
- [x] 3.2 Extend `saveDraft` to carry it, in the same try/catch as the selections and the invoice.
- [x] 3.3 In `CreateDocumentView.vue`, add `MONEY_MOVED_ON_KEYS` beside the other two and build the
      payload from `headerFields`; pass it from the edit branch on `selectionsLocked`.
- [x] 3.4 Disable the `money-moved-on` picker on `selectionsLocked`.

## 4. Client — tests

- [x] 4.1 Component test: a corrected day is sent on save.
- [x] 4.2 Component test: a refused save surfaces the error and reports no success.
- [x] 4.3 Component test: the picker is disabled once the document has left `DRAFT`.
- [x] 4.4 Regression test: the selections and invoice payloads still travel on the same save.

## 5. Verify

- [x] 5.1 Run the `back/` and `front-end/` unit suites.
- [x] 5.2 Run the REAL typecheck (`pnpm --filter front-end typecheck`, i.e. `vue-tsc -b`) — the root
      `tsconfig.json` is `files: []` with project references, so `vue-tsc -p tsconfig.json` checks
      nothing and silently passes.
- [x] 5.3 Re-run the drop probe and confirm all three header values now appear in what `saveDraft`
      receives.

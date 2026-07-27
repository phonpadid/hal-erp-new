## 1. Guard the two writes

- [x] 1.1 In `DocumentService.setFieldValues`, refuse when the document is not `DRAFT`, using the
  invalid-state code and a message that names the way out — return it to `DRAFT` and it becomes
  editable, at the cost of the whole chain approving again. Mirror `setPayee`'s wording; it already
  says this well.
- [x] 1.2 Do the same in `setLines`.
- [x] 1.3 Guard in the service, not the controller, so a second caller written later inherits the
  rule — the same reason `setPayee` guards where it does.
- [x] 1.4 Touch nothing else. Attachments stay writable at any status, deliberately, and the claim
  team has been told so.

## 2. Prove it

- [x] 2.1 Spec: writing field values to an `IN_APPROVAL` document is refused with the invalid-state
  code, and the stored values are unchanged — assert the stored values, not only the throw, because
  a guard that rejects after writing would pass a throw-only assertion.
- [x] 2.2 Spec: writing lines to a `COMPLETED` document is refused and the stored lines are
  unchanged.
- [x] 2.3 Spec: both writes still succeed on a `DRAFT`. This is the regression guard for the whole
  create-and-edit flow the web app uses.
- [x] 2.4 Spec: a document returned to `DRAFT` accepts writes again.
- [x] 2.5 Spec: an attachment upload still succeeds on an `IN_APPROVAL` document.

## 3. Verify

- [x] 3.1 Run the full `pnpm --filter back test`. Watch the document-engine specs in particular:
  any fixture that edited a submitted document was relying on the gap and is now a finding, not a
  failure to work around.
- [x] 3.2 Run `pnpm --filter front-end run ci` — the store's `saveDraft` path is exercised there,
  and it must still pass because the web app only ever calls it on a draft.
- [x] 3.3 Run `pnpm --filter back boot:check`.

## 4. Say it where it was promised

- [x] 4.1 The claim guide currently warns that fields and lines are NOT frozen and that we are
  closing the gap. Replace that warning with the rule now that it is true, and keep the sentence
  that attachments are still writable — it was answered explicitly and stays correct.

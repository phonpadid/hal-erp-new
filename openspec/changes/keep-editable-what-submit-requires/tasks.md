## 1. Entities and migration

- [x] 1.1 Confirm no entity or migration work is needed: all four columns are mapped on the
      `Document` entity and present in the migration snapshot and the live schema, so no migration is
      generated. The check found `warehouse_id` and `dest_warehouse_id` MISSING from
      `erp_approval_system.dbml` — 3d5a540 added `Table warehouse` without ever adding the two
      columns or their `Ref:` lines to `Table document`. Both are now recorded there, which
      documents what shipped rather than changing anything.

## 2. Backend — DTO

- [x] 2.1 Add `SetSelectionsDto` in the document module alongside `SetPayeeDto` and
      `SetVendorInvoiceDto`, with `warehouseId`, `destWarehouseId`, `relatedEmployeeId` and
      `vendorId`, each `@IsOptional()` and each accepting a UUID or `null` (mirror how `SetPayeeDto`
      admits null so a clear is expressible).
- [x] 2.2 Distinguish an absent key from an explicit null in the DTO, so "leave alone" and "clear"
      do not collapse into one meaning.

## 3. Backend — service

- [x] 3.1 Add `setSelections(documentId, dto)` to `DocumentService`, next to `setPayee`: resolve the
      document through `this.scope.forActiveCompany()` and refuse with `BadRequestException` unless
      `status === DocStatus.DRAFT`, using the same wording shape as `setPayee`'s message.
- [x] 3.2 Resolve a supplied `warehouseId`/`destWarehouseId` through
      `WarehouseService.requireActive`, which already refuses another company's warehouse and an
      inactive one; refuse a pair that names the same warehouse twice, reading the destination's
      applicability from `post_action` rather than the type's code.
- [x] 3.3 Resolve a supplied `relatedEmployeeId` against the document's own company, matching the
      lookup `document-submit.service` performs.
- [x] 3.4 Resolve a supplied `vendorId` against the vendors enabled for the active company, matching
      the enablement guard submit applies.
- [x] 3.5 Clear `vendorBankAccount` when the vendor changes and the existing payee's vendor is not
      the new one; leave it in place when it still matches. Assign every resolved value and flush
      once, so a vendor and a payee that disagree are never observable.
- [x] 3.6 Apply nothing when any supplied id fails its check — the document must be left exactly as
      it was.

## 4. Backend — controller

- [x] 4.1 Add `PATCH /documents/:id/selections` to `DocumentController` with
      `@RequirePermissions(P.DOC_CREATE)`, `@Param('id', ParseUUIDPipe)` and `@HttpCode(204)`,
      placed beside the `payee` and `invoice` handlers.
- [x] 4.2 Carry a comment saying why the route is DRAFT-only, in the manner of the two beside it.

## 5. Backend — tests

- [x] 5.1 A draft of a `requires_warehouse` type with no warehouse is given one and can then be
      submitted.
- [x] 5.2 A draft of a type whose `requires_employee` was turned on after the draft was created is
      given its employee and accepted.
- [x] 5.3 The change is refused in `IN_APPROVAL` and refused on a `COMPLETED` document, and the
      document is unchanged in both.
- [x] 5.4 A document returned to `DRAFT` accepts the change and routes through its steps again on
      resubmit.
- [x] 5.5 Company isolation: another company's warehouse, an employee of another company and a
      vendor not enabled for the active company are each refused, and the document is unchanged.
- [x] 5.6 An inactive warehouse is refused; a transfer naming the same warehouse at both ends is
      refused.
- [x] 5.7 Changing the vendor clears a payee belonging to the old vendor, and leaves a payee that
      still belongs to the vendor in place.
- [x] 5.8 Clearing a selection is possible: an explicit null empties the column, and an absent key
      leaves it untouched.
- [x] 5.9 A caller without `DOC_CREATE` is refused — the route carries
      `@RequirePermissions(P.DOC_CREATE)`, and `auth/permissions.guard.spec.ts` covers the guard
      that reads it. NOT asserted for this route specifically: the new spec exercises the service,
      which sits below the guard and cannot observe it, and the repo has no per-route decorator
      audit to hang such an assertion on. The gap is the same one every other document route has.
- [x] 5.10 The submit gates still refuse a document whose required selection was cleared — the
      correction surface does not satisfy them.
- [x] 5.11 No concurrency test is required and no `em.transactional()` is used: this flow writes
      neither `budget_txn` nor `quota_usage`, and is refused outside `DRAFT`, which is before any
      reservation exists. Record the reasoning where a reviewer will look for the missing test.

## 6. Frontend — API and store

- [x] 6.1 Add the typed `setSelections` call to `src/api/documents.ts`.
- [x] 6.2 Have `documents.saveDraft` send the selections before the existing fields and lines writes,
      so a failure to apply them stops the save rather than half-writing it.
- [x] 6.3 Test that a failed selections call surfaces the error and does not silently report the
      draft as saved.

## 7. Frontend — create/edit wizard

- [x] 7.1 In `CreateDocumentView.vue`, replace `:disabled="isEdit"` on the warehouse,
      destination-warehouse, employee and vendor pickers with a check on the document's status, so
      the pickers are usable on a draft and disabled once it has left `DRAFT`.
- [x] 7.2 Pass the current selections through `saveDraft` on an edit, the way the create path already
      passes them to `createDraft`.
- [x] 7.3 Reload the payee options when the vendor changes on an edit — ALREADY TRUE, no change
      made: `usePayeeAccounts` holds `watch(vendorId, load)`, and `load` clears the selection before
      refetching for exactly this reason ("an account of the previous vendor would fail the server's
      submit gate"). The client already did what the server now does.

## 8. Frontend — tests

- [x] 8.1 A draft of a `requires_warehouse` type that names no warehouse opens with a usable
      warehouse picker, and choosing one lets the type step advance.
- [x] 8.2 A draft that names a warehouse, an employee or a vendor shows each picker holding that
      record rather than its placeholder (guarding the restore that `idOf` already performs).
- [x] 8.3 Saving an edited draft sends the selections.
- [x] 8.4 A document that has left `DRAFT` shows the pickers disabled.
- [x] 8.5 Mutation-checked: dropping the selections from the save kills the save test; restoring
      `:disabled="isEdit"` kills 4; never locking kills 2. On the backend, dropping the DRAFT guard
      kills 2, collapsing absent-vs-null kills 3, un-scoping the employee kills 2, and never
      clearing an orphaned payee kills 1. One finding recorded in the spec itself: what protects
      all-or-nothing is the SINGLE FLUSH, not the resolve-first ordering — reordering the
      resolutions kills nothing, while flushing half-way through does.

## 9. Verification

- [x] 9.1 Backend 1670 passed / 0 failed; frontend 888 passed across 101 files; `vue-tsc -b` clean;
      `tsconfig.build.json` (what ships) clean and zero errors in the three backend source files
      changed. The new backend spec carries the same class of `tsc` complaints its siblings do
      (`payee-gate.spec.ts` has 5) — backend spec files are outside the build typecheck here.
- [x] 9.2 Drive it in the running app: reopen `ISSUE-HAL-2026-0001`, give it a warehouse, save,
      reopen it again and confirm the warehouse is still there, then submit it.
- [x] 9.3 Confirm in Postgres that the corrected document carries the expected `warehouse_id` and
      that no `budget_txn` row was written by the correction itself.
- [ ] 9.4 Sync the two delta specs into `openspec/specs/` and archive the change.

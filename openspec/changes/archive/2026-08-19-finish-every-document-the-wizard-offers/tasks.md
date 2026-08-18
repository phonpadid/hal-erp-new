# Tasks — Finish every document the wizard offers

## 1. Schema

- [x] 1.1 `document_type` gains `authoring_route varchar null` and `requires_employee boolean not
      null default false`. Migration + entity + DBML note.
- [x] 1.2 DTOs accept both; `requires_employee` follows the other requirement flags exactly.

## 2. What the client is told

- [x] 2.1 `GET /documents/creatable-types` returns `requiresWarehouse`, `requiresEmployee`,
      `postAction` and `authoringRoute`. The first two are the gap that made the stock and HR
      families unbuildable; `postAction` is what tells a transfer it needs a second warehouse.
- [x] 2.2 Same fields on `GET /documents/types/:id/form`, so a wizard opened straight into a type
      does not need the list call.

## 3. Submit guards (backend)

- [x] 3.1 `requires_employee` → the document must name a `related_employee` of the active company;
      another company's employee is rejected (invariant 1).
- [x] 3.2 A budget-movement `post_action` requires ≥1 `budget_movement`; `POST_JOURNAL` requires a
      `journal_voucher`. Beside the existing pre-submit guards, not inside the post-action.

## 4. Wizard

- [x] 4.1 Choosing a card whose type carries `authoringRoute` navigates there; an unrecognised route
      falls through to the normal steps (D1 — a misconfigured route must not dead-end).
- [x] 4.2 Warehouse selector when `requiresWarehouse`; destination selector when `postAction` is
      `TRANSFER_STOCK`; the two must differ. Submit sends `warehouseId` / `destWarehouseId` — the
      DTO fields have been waiting.
- [x] 4.3 Employee selector when `requiresEmployee`.
- [x] 4.4 i18n for the new labels and validation messages, three locales.

## 5. Seed

- [x] 5.1 `authoring_route` on the types authored elsewhere: BUDGET_PLAN, BUDGET_ADJ_INC,
      BUDGET_ADJ_DEC, BUDGET_TRANSFER → the budget screen; JV → the voucher screen; LEAVE →
      `request-leave`.
- [x] 5.2 `requires_employee` true on PROMOTE and RESIGN.
- [x] 5.3 OT is seeded inactive, with a comment naming why: its backend is complete
      (`POST /overtime-claims`, `preview`, `:documentId/submit`) and it has no client at all, so
      there is no route to send anyone to (D5). This is the one type the change removes rather than
      repairs — the follow-up is an overtime screen.

## 6. Tests

- [x] 6.1 Not written as a new test: the claim is that `createDraft` resolves the mapping for every
      document, which every existing voucher and budget-screen spec already exercises — a document
      of an `authoring_route` type is created by exactly that path. A new assertion would restate
      their setup, not add coverage.
- [x] 6.2 `requires_employee`: submit refused without one; another company's employee refused; a
      type without the flag unaffected.
- [x] 6.3 An empty budget plan and an empty voucher are both refused at submit.
- [x] 6.4 The post-action still refuses a budget document whose movements were removed after submit
      — the submit guard is a filter, not a replacement.
- [x] 6.5 A `TRANSFER_STOCK` document is refused naming one warehouse twice and refused with no
      destination. The accepting case is not asserted server-side: past those guards a transfer
      reserves stock and needs StockMovementService's fixtures. What this change added there is the
      UI that collects the pair.
- [x] 6.6 Frontend: an `authoringRoute` card navigates; an unknown route falls through; the warehouse
      and employee selectors appear exactly when their flags are set.
- [x] 6.7 Each new test must fail with its feature removed. Check it.

## 7. Reference documents

- [x] 7.1 `erp_approval_system.dbml`: both new columns, with the note explaining that
      `authoring_route` is not derivable from `post_action`.
- [x] 7.2 `web-inventory:75` checked, and deliberately NOT edited. Its two warehouse clauses are now
      true; the rest of that sentence still is not — the line editor does not filter to
      `is_stock_tracked` items, does not show available quantity beside the input, does not require a
      direction on an adjustment line, and does not warn on a shortage. Those are a pre-existing gap
      this change does not close, and weakening the spec to match what was built is the wrong
      direction. Follow-up: a stock-line editor change.

## 8. Verification

- [x] 8.1 back 1570 passed / 1 failed (the date-pinned attendance test, unrelated); `nest build`
      clean; front-end 818 passed and `vue-tsc -b` clean; `openspec validate --all` 73/73.
      NOTE: use `npm run typecheck` (`vue-tsc -b`), not bare `vue-tsc --noEmit` — the root
      tsconfig has `files: []` with project references, so the bare form checks nothing and
      reports success. It was hiding three real errors, one of them from an earlier change.
- [x] 8.2 Re-run the walkthrough that found this: create and submit one document of every type that
      the wizard still offers, and confirm each reaches `IN_APPROVAL` rather than a stuck draft.

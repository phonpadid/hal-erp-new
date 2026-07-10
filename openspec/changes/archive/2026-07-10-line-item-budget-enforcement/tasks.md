## 1. Schema + entity (requires_item)

- [x] 1.1 Add `requires_item boolean [default: false]` to `document_type` in
  `erp_approval_system.dbml` (next to `requires_vendor`)
- [x] 1.2 Add the `requiresItem` property to the `DocumentType` entity (default false, NOT NULL)
- [x] 1.3 Generate a migration adding the column with `DEFAULT false NOT NULL`

## 2. Document-type config surface (backend)

- [x] 2.1 Add optional `requiresItem` (`@IsBoolean`) to `CreateDocumentTypeDto` and
  `UpdateDocumentTypeDto`
- [x] 2.2 Persist `requiresItem` in the document-type create/update service and include it in
  the document-type read/list projection
- [x] 2.3 Unit test: create/update round-trips `requiresItem`; defaults to false when omitted

## 3. Submit enforcement (document-engine)

- [x] 3.1 In `document-submit.service`, when `docType.requiresItem`, reject submit if any line
  has no `item` — a `BadRequestException` naming the line — before any hold is taken
- [x] 3.2 Replace the `reserveLines.length === 0` guard with complete-coverage: on
  `requires_budget`, reject submit if any line with a positive `line_amount` has no `budget`,
  naming the line
- [x] 3.3 Keep the zero-amount carve-out: a line with `line_amount = 0` is not required to
  carry a budget (it reserves nothing)
- [x] 3.4 Ensure both rejections leave the document DRAFT with no budget/quota reserved
- [x] 3.5 Unit tests: item-mandatory type rejects an item-less line and accepts all-item
  lines; a positive budget-less line is rejected while a zero-amount budget-less line passes;
  a fully-covered budget document still reserves once per line

## 4. Frontend document-type admin (web-doc-config)

- [x] 4.1 Add a `requires_item` toggle to the document-type create/edit form
- [x] 4.2 Add "item" to the requirement-flag filter (AND semantics with the other flags)
- [x] 4.3 Update the shared doc-type Zod schema to include `requiresItem`, mirroring the DTO
- [ ] 4.4 Component test: the toggle round-trips and the item filter narrows the list _(deferred: frontend vitest not installed in this env; existing DocTypesView filter tests remain valid with the additive 'item' option)_

## 5. Verification

- [x] 5.1 Run `openspec validate --changes line-item-budget-enforcement --strict`
- [x] 5.2 Backend suites green (document-engine submit guards, document-type config)
- [x] 5.3 Migration applies cleanly on a fresh schema and existing types read `requiresItem = false`

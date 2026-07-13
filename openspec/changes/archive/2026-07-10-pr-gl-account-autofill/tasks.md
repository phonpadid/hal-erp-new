## 1. Budget resolution read (budget-control)

- [x] 1.1 Add a service method that resolves the single `ACTIVE` budget for
  `(company_id, fiscal_year_id, department_id, gl_account)`, returning only `id`,
  `budgetName`, `glAccount` (no amount-bearing fields); returns null when none matches
- [x] 1.2 Add a helper to resolve the company's `fiscal_year` whose `[start_date, end_date]`
  contains a given document date, rejecting when none is OPEN for that date
- [x] 1.3 Expose the resolve-budget read on the endpoint, guarded by the `DOC_CREATE`
  permission code, scoped to the active company
- [x] 1.4 Unit test: unique active budget resolves; no match returns empty; other-company
  budget never returned; unauthorized without `DOC_CREATE`

## 2. Line GL + budget derivation (document-engine)

- [x] 2.1 In the document line create/edit service, when `itemId` is present, load the
  company-enabled `item` and set `gl_account` from `item.default_gl_account`, discarding any
  client-sent `gl_account`
- [x] 2.2 Resolve the line's `budget_id` via the budget-control resolver from the derived
  `gl_account` + `document.department_id` + resolved fiscal year
- [x] 2.3 For `requires_budget` types, reject save/submit when the item has no
  `default_gl_account` or no active budget resolves, with an error naming gl_account,
  department, and fiscal year
- [x] 2.4 Keep the item-less line path: a line with no `itemId` on a `requires_budget` type
  uses an explicitly selected `budget_id` (selectable-budgets read), with no GL derivation
- [x] 2.5 Re-resolve and re-validate GL/budget at submit (do not trust a stored `budget_id`
  that may have been deactivated since draft)
- [x] 2.6 Update line create/edit DTOs so `gl_account` is not a client input on item-backed
  lines; validate `itemId` with `ParseUUIDPipe`/class-validator
- [x] 2.7 Unit tests: item derives GL + budget; client GL ignored; item without GL rejected;
  no matching budget rejected; item-less line uses explicit budget; company-scoped
- [x] 2.8 Concurrency/integration test: submit re-resolution rejects a line whose budget was
  deactivated after draft

## 3. Reconcile master-data wording

- [x] 3.1 Confirm no code path treats the line GL as requester-editable for item-backed
  lines; the item registry read/UX exposes `default_gl_account` as data, not an editable
  line field

## 4. Frontend line-item editor (web-documents)

- [x] 4.1 In `LineItemsEditor.vue`, make the item picker (company-enabled items) the primary
  per-line control and send only `itemId` for item-backed lines
- [x] 4.2 Display the item's default GL account and the resolved budget as read-only;
  remove any control that lets the requester type or pick a raw GL code
- [x] 4.3 Show the explicit budget picker only for a line that carries no item on a
  `requires_budget` type; hide it once an item is selected
- [x] 4.4 Surface the server's rejection (no GL / no active budget for department+year) as a
  line-level error on save/submit
- [x] 4.5 Update/add the line Zod schema to mirror the DTO (no client `glAccount` for
  item-backed lines); keep client and server validation in sync

## 5. Verification

- [ ] 5.1 e2e (Playwright): requester creates a PR for an electricity item, sees GL + budget
  auto-filled read-only, submits successfully _(deferred: Playwright not runnable in this env)_
- [ ] 5.2 e2e: item without a default GL is blocked with a clear message _(deferred: as 5.1)_
- [x] 5.3 Ran `openspec validate --changes pr-gl-account-autofill --strict` (passes) and the
  backend suites for this change are green (`gl-account-autofill.spec.ts` 9/9, `budget-selectable`
  resolve gate, `document-engine.service` 14/14). Frontend `vue-tsc` clean for changed files;
  frontend `vitest` is not installed in this env, so its suite could not be executed.

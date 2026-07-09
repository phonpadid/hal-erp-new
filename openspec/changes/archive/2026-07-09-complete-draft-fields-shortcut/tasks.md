## 1. FormStepper: open on a requested step

- [x] 1.1 Add optional `initialStep?: string` prop to `FormStepper.vue`
- [x] 1.2 On mount, resolve `initialStep` to a step index by matching `StepDef.key`; default to 0 when absent or unmatched (keep `index` as the single source of truth)
- [x] 1.3 Add/adjust a unit test asserting the stepper starts on the resolved step and falls back to the first step for an unknown key

## 2. Edit wizard: read the deep-link step and focus

- [x] 2.1 In `CreateDocumentView.vue`, read `route.query.step` and pass it to `FormStepper` as `initialStep` (only meaningful in edit mode)
- [x] 2.2 When landed on the Details step for a draft, focus the first empty required field by its input id (best-effort; no-op if not found)

## 3. Detail: missing-required-fields notice

- [x] 3.1 In `DocumentDetailView.vue`, compute the visible required fields whose value is empty, reusing the shared `isFieldVisible` evaluator and the form fields + field values already loaded
- [x] 3.2 Gate the computed notice on the existing `canEdit` (DOC_CREATE + status DRAFT)
- [x] 3.3 Render an inline notice listing the missing field labels with a single action button that routes to `document-edit` with `?step=details`

## 4. i18n

- [x] 4.1 Add `documents` keys for the notice title, missing-field list phrasing, and the button label in `en` locale
- [x] 4.2 Add the matching keys in `la` locale

## 5. Verify

- [x] 5.1 Drive the flow in the running app: auto-created (or manually created) DRAFT PO with empty `reason` shows the notice; clicking it lands on the Details step with `reason` focused; after fill + save, submit succeeds
- [x] 5.2 Confirm no notice appears for a non-draft, without edit permission, or when all visible required fields are filled

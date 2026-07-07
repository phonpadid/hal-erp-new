## Why

The Create Document wizard (`/documents/new`) is functionally complete but visually and
ergonomically dated: the document-type step is a bare `<Select>` with no context, the
line-item editor crams eight controls into one flex row that is hard to scan, quantity and
unit price use raw `<InputText type="number">` (no currency-aware formatting or steppers),
validation errors surface only as a single banner at the top of the page, and there are no
first-load skeletons or accessibility affordances for required/invalid state. This is the
primary data-entry surface of the whole ERP — polishing its UX/UI directly improves how
fast and correctly users can raise documents.

## What Changes

- **Document-type step** becomes a set of selectable cards (icon + name + short
  description), keyboard-navigable, replacing the bare dropdown — with currency and vendor
  pickers kept inline for money/vendor types.
- **Line-item editor** is reworked into an aligned, legible grid (cleaner columns on
  desktop, stacked labelled cards on mobile); quantity and unit price move to PrimeVue
  `<InputNumber>` with currency-aware decimals/step; per-line amount and remove are clearer.
- **Persistent summary bar**: the running document total (and the primary Save/Submit
  actions on the last step) stay visible via a sticky footer so users always see the total.
- **Validation feedback** becomes contextual: field- and line-level errors render inline at
  the offending input (not only the top banner), and a failed step advance moves focus to
  the first error.
- **First-load & async feedback**: skeletons while types/budgets/vendors/currencies load, so
  the type step is never a blank control.
- **Accessibility & mobile**: required/invalid state exposed via `aria-required`/
  `aria-invalid` with associated descriptions, correct label-for wiring, sensible focus
  order between steps, and a tightened responsive layout.
- All new/changed strings localized in `la` + `en`. No change to the submit contract, the
  config-driven field model, money-as-string handling, or any server behavior.

## Capabilities

### New Capabilities
<!-- None. All behavior lives under the existing web-documents capability. -->

### Modified Capabilities
- `web-documents`: Strengthen the create-wizard requirements — **Line-Item Editor
  Usability** (grid layout + `<InputNumber>` + accessible per-line feedback), **Validation
  Feedback** (inline contextual errors + focus-to-error), and **Responsive and Token-Based
  Rendering** (sticky summary bar, mobile line cards, ARIA for required/invalid). Add a
  **Document Type Selection** requirement (card picker) and a **First-Load Feedback**
  requirement (skeletons).

## Impact

- **Code:** `front-end/src/views/documents/CreateDocumentView.vue` (primary), a likely new
  `LineItemsEditor.vue` and `DocumentTypePicker.vue` extracted for clarity, `FormStepper.vue`
  (focus-to-error hook), and `src/i18n/locales/{en,la}/documents.ts` for new strings.
- **Tests:** extend the documents view/smoke tests for the card picker, InputNumber line
  editing, inline error placement, and skeleton states; keep `vue-tsc -b` clean.
- **No impact** on backend, the submit/draft API, the DBML, or money/FX invariants — amounts
  stay strings/`Decimal`, the server remains authoritative, FX stays locked at submit.

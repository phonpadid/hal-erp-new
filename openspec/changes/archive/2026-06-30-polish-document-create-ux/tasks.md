## 1. Groundwork

- [x] 1.1 Audit `front-end/src/views/documents/CreateDocumentView.vue` and `FormStepper.vue` to map the current step templates, the reactive state (`selectedType`, `currency`/`previewRate`, `vendorId`/`selectedVendor`, `fieldControls`, `lines`/`docTotal`), and how `step-error` is surfaced.
- [x] 1.2 Add the new i18n keys to both `front-end/src/i18n/locales/en/documents.ts` and `.../la/documents.ts` (review section headings, field/value labels, line column headers, grand total, empty-state text + add-first-line, required-field hint, locked-rate note). Keep keys parallel across both locales.

## 2. Review Step Summary

- [x] 2.1 Replace the minimal Review template with a read-only summary derived from the existing refs/computed: document type, currency, vendor (only when `selectedType()?.requiresVendor`), and the list of currently-visible fields (filtered through `isFieldVisible` / `fieldControls`) with label + value.
- [x] 2.2 Render the full line list in the Review with each line's amount and a grand total, formatting every amount through the currency-format composable (`decimal_places`); never coerce to a JS number.
- [x] 2.3 Show the foreign-currency base preview + locked-rate note in the Review when `isForeign` and `basePreview` are present; omit silently when no rate is available.
- [x] 2.4 Verify hidden conditional fields never appear in the Review (same `isFieldVisible` evaluator as render + payload).

## 3. Line-Item Editor

- [x] 3.1 Restructure the lines step from the wrapping flex row into an aligned grid: single header row + per-line rows aligned to the columns (item/GL when `canMaster`, description, qty, unit price, budget when `BUDGET_VIEW`, amount, delete).
- [x] 3.2 Add a totals footer showing the running document total (`docTotal`) and the advisory base preview when foreign, formatted by `decimal_places`.
- [x] 3.3 Add an explicit empty state with an "add first line" affordance when `lines` is empty; keep add/remove working.
- [x] 3.4 Add per-line numeric feedback for quantity and unit price (negative / non-numeric flagged) consistent with the existing `validateStep('lines')` rule.

## 4. Validation & Feedback

- [x] 4.1 Surface per-step validation failures through `FormStepper`'s `step-error` so the failing step is marked and the reason shown; keep field-level `<Message>` inline next to the offending field/line.
- [x] 4.2 Add a visible required indicator on required fields in the details step.
- [x] 4.3 Wire Save/Submit busy + disabled states off the existing `busy` ref to prevent double submission, and ensure the server error is surfaced verbatim via the existing feedback path.

## 5. Visual & Responsive Pass

- [x] 5.1 Tidy spacing/grouping of all four steps using only PrimeUI theme tokens (no hardcoded colors); confirm light + dark both render.
- [x] 5.2 Make the stepper and wizard body reflow on narrow screens; stack line-item columns with labels at mobile width without horizontal clipping.

## 6. Verification

- [x] 6.1 Manually walk `/documents/new` for a money type (e.g. PR: vendor + currency + lines) and a non-money type (e.g. LEAVE/MEMO): confirm Review summary completeness, running total, conditional-field hiding, validation messages, and dark mode.
- [x] 6.2 Run the frontend typecheck (`vue-tsc`) and update/extend any Vitest/Playwright assertions for the documents create view that reference the Review step or line editor; ensure the suite passes.
- [x] 6.3 Confirm no backend/DTO/schema/API files changed and that all new user-facing strings resolve in both `la` and `en`.

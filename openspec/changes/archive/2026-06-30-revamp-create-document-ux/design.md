## Context

`CreateDocumentView.vue` is a ~500-line single-file wizard built on `FormStepper` (a thin
wrapper over PrimeVue `Stepper`). It already does the hard domain work correctly: config-driven
dynamic fields (`isFieldVisible`/`fieldComponent`), money as `Decimal`/strings, locked-FX
preview, vendor/item enablement, draft vs edit. The weaknesses are presentational and
ergonomic, not behavioral: a bare type `<Select>`, a single cramped flex row per line, raw
numeric `<InputText>`, a page-level-only error banner, and no first-load or accessibility
affordances. The revamp must preserve every invariant (money never a JS number, server
authoritative, FX locked at submit, config-driven behavior) while improving the surface.

## Goals / Non-Goals

**Goals:**
- A clearer, more guided entry flow: type-as-cards, a scannable line editor, inline errors,
  a persistent total, first-load skeletons, and real accessibility.
- Keep the diff reviewable by extracting two presentational components rather than rewriting
  the orchestration.
- No behavioral or contract change; existing documents tests keep passing.

**Non-Goals:**
- No change to the submit/draft API, payload shape, or the dynamic-field config model.
- No new money math; `Decimal`/`lineAmount` stay the single source of amounts.
- No autosave/draft-recovery backend work (a hint only, if any).
- Not a visual redesign of the whole app — scoped to `/documents/new` (and its edit route).

## Decisions

- **Extract `DocumentTypePicker.vue` and `LineItemsEditor.vue`.** The view stays the
  orchestrator (state, payload, save); the two busiest presentational concerns move into
  focused components that are easy to test and style. *Alternative:* edit in place — rejected;
  the file is already long and the line editor template is the densest part.
- **`<InputNumber>` for qty/unit price, bound to strings via `:modelValue`/`@input`.** It gives
  locale-aware grouping, `:minFractionDigits`/`:maxFractionDigits` from the currency's
  `decimal_places`, and `:min="0"`, removing the manual negative/NaN guard from the happy path
  while keeping the value a string handed to `Decimal`. *Risk:* InputNumber emits `number`;
  we convert at the boundary and never store the number — covered by a test asserting amounts
  remain strings. *Alternative:* keep `InputText type=number` — rejected; no formatting, poor
  mobile keyboards, and the invalid-state styling is manual.
- **Type cards via PrimeVue `Card`/`SelectButton`-style radios, not a custom widget.** Use a
  radiogroup pattern (`role=radiogroup` + `role=radio`/`aria-checked`) so keyboard + SR work
  comes from semantics, not script. *Alternative:* `DataView` grid — heavier than needed.
- **Sticky summary bar** is a `position: sticky` footer inside the card rendering the running
  total always, and the Save/Submit actions on the final step. Pure CSS with theme tokens; no
  JS scroll listeners. *Alternative:* a floating action button — rejected as less discoverable
  for a total.
- **Focus-to-error** added to `FormStepper`: when `validateStep` returns an error, emit the
  failing field/line key so the view can focus it (and `FormStepper` already marks the errored
  step). Keep the gate logic where it is; only add an optional focus target. *Alternative:*
  move all validation into the view — rejected; the stepper gate is shared and tested.
- **Skeletons** use the existing `TableSkeleton`/PrimeVue `Skeleton` while `types`/`budgets`/
  `vendors`/`currencies` load; a per-list `loading` ref replaces "empty means loaded".
- **Accessibility** is wired through native semantics: `label for`/`:id`, `aria-required`,
  `aria-invalid` + `aria-describedby` to the inline `<Message>`, and `aria-label` on icon-only
  buttons (remove-line already has one). No custom ARIA framework.

## Risks / Trade-offs

- **InputNumber ↔ string boundary** could reintroduce float money if bound carelessly →
  convert only at the input edge, keep `lineAmount`/`docTotal` on `Decimal`, and assert with a
  test that the collected payload values are strings.
- **Component extraction can change behavior subtly** (v-model wiring, conditional columns by
  permission) → port the exact `canMaster`/`BUDGET_VIEW` gating and cover with the existing +
  new smoke tests before/after.
- **Sticky footer on mobile** can overlap content or the keyboard → reserve bottom padding and
  test at narrow width; fall back to non-sticky if it clips.
- **Scope creep into a full redesign** → the spec deltas bound this to type cards, line editor,
  validation feedback, sticky total, skeletons, and a11y; anything else is a separate proposal.

## Migration Plan

1. Add i18n strings (type descriptions, skeleton/loading, a11y hints) to `en` + `la` first so
   parity tests stay green.
2. Extract `LineItemsEditor.vue` (with `<InputNumber>`, grid/mobile cards, inline errors),
   wire into the view behind identical state — verify smoke + payload tests.
3. Extract `DocumentTypePicker.vue` (cards/radiogroup), wire in with skeleton.
4. Add the sticky summary bar and `FormStepper` focus-to-error hook.
5. Pass the a11y wiring across fields and lines; re-run `vue-tsc -b` + full suite.
6. Frontend-only, behavior-preserving — rollback is a plain revert.

## Open Questions

- Should the type cards show anything beyond icon/name/description (e.g. category badge,
  "requires vendor/budget" hints)? Leaning: a small category badge only, to avoid clutter.
- Is a lightweight "unsaved changes" guard on navigation in scope, or a separate proposal?
  Leaning: out of scope here.

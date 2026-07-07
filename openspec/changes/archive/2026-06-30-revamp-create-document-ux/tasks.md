> **Result:** `/documents/new` revamped across all four areas. New components
> `DocumentTypePicker.vue` + `LineItemsEditor.vue`; sticky total, skeletons, inline errors
> with focus-to-error, ARIA. Suite 200 → **212 tests**, `vue-tsc -b` clean, build OK.

## 1. Strings & scaffolding

- [x] 1.1 Added `typeStepHint`, `typeGroupLabel`, `loading`, `documentTotal`, `requiredHint`, and a `category.{PROCUREMENT,FINANCE,HR,ADMIN,IT,OTHER}` map to `en` + `la` documents locales
- [x] 1.2 `i18n.parity.spec.ts` + `no-literal-text.spec.ts` pass

## 2. Line-item editor overhaul

- [x] 2.1 Extracted `src/views/documents/LineItemsEditor.vue` (v-model lines), porting exact `canMaster`/`canBudget` column gating, empty state, add/remove
- [x] 2.2 qty/unit price now PrimeVue `<InputNumber>` (`min=0`, currency `decimal_places` via `minFractionDigits`/`maxFractionDigits`); converted at the edge — values stay strings (test: "keeps money a string when InputNumber emits a number")
- [x] 2.3 Desktop grid + narrow-width stacked labelled cards
- [x] 2.4 Per-line `<Message id="line-err-i">` associated via `aria-describedby` + `aria-invalid`; accessible label on remove
- [x] 2.5 Wired into the view; `lineInvalid` moved to `utils/form.ts` (single source); running total + string payload verified

## 3. Document-type picker

- [x] 3.1 Extracted `src/views/documents/DocumentTypePicker.vue` — `role=radiogroup`/`role=radio` `<button>` cards (icon + name + category description), `aria-checked`, keyboard-operable
- [x] 3.2 Currency (money types) + vendor (`requires_vendor`) pickers kept inline; edit-mode renders read-only (disabled cards)
- [x] 3.3 Skeleton while the type list loads; wired into the type step

## 4. Visual polish & persistent summary

- [x] 4.1 Sticky summary bar (`sticky bottom-0`, theme tokens, backdrop blur) shows the running document total whenever lines exist; Save/Submit stay in the stepper's actions slot
- [x] 4.2 Tightened type-step/details hierarchy; tokens only — no hex/rgb (grep-verified), dark mode via `dark:` + `var(--p-*)`

## 5. Flow & feedback

- [x] 5.1 `loadingTypes`/`loadingData` refs → skeletons instead of empty controls on first load; failed reference loads leave the control empty (existing `.catch(() => [])`) without blocking
- [x] 5.2 Inline errors: per-field required `<Message>` under the offending field and per-line in the editor, in addition to the page-level summary banner
- [x] 5.3 `FormStepper` now emits `step-error(message, key)`; the view's `onStepError` marks the step attempted and focuses the first offending input (`vendor` / first missing field / first invalid `qty-i`)
- [x] 5.4 `aria-required` on required dynamic fields + the required indicator; `label for`/`:id` wiring on every control (incl. InputNumber `inputId`, currency/vendor selects)

## 6. Verification

- [x] 6.1 `create-document-ux.spec.ts` (8 tests): type-card radiogroup + click-select + disabled + skeleton; editor empty state, string-math amount, InputNumber→string, aria-associated line error. `FormStepper` emit test updated for the new `key` arg
- [x] 6.2 `vue-tsc -b` clean; full Vitest suite green (212); `vite build` succeeds
- [x] 6.3 Token-only verified statically (no hex/rgb; only the pre-existing `text-red-500` asterisk convention); responsive `sm:`/`md:` reflow + both locales present. A live browser walk needs the running backend; smoke-render + build is the automated proxy
- [x] 6.4 `openspec validate revamp-create-document-ux` → valid

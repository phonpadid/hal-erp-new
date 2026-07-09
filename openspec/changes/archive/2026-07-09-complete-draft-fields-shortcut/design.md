## Context

`document.service.createFrom` copies a predecessor's header + line items but not its form field values, so an auto-created PO (from a PROC with `post_action = CREATE_PO`) starts DRAFT with empty form fields. The submit gate in `document-submit.service.ts` rejects a submit while any visible required field is empty. The Detail view (`DocumentDetailView.vue`) is read-only and only offers a generic Edit button that opens the wizard at its first step; the user must click through Type → Details to reach the field. The edit wizard (`CreateDocumentView.vue`) drives a `FormStepper` whose active step index is a private `ref(0)`.

We deliberately keep field entry manual on the successor — the decision is to remove navigation friction, not to auto-fill from the predecessor.

## Goals / Non-Goals

**Goals:**
- On a draft the user can edit, show which visible required fields are still empty, directly on the Detail page.
- One click from that notice lands the user on the wizard's Details step, focused on the first empty required field.
- Reuse the existing edit form and its validation — no second form implementation.

**Non-Goals:**
- No change to `createFrom`, auto-create, or the submit gate.
- No copying of field values from the predecessor.
- No inline editing on the Detail page (keeps it read-only; avoids duplicating form/validation logic and the client/server drift that would invite).

## Decisions

- **Deep link via route query, not new route.** The `document-edit` route gains an optional `?step=<key>` query. `CreateDocumentView` reads it and passes an initial step to `FormStepper`. Keeping it a query (not a param) means existing links keep working and the value is a soft hint.
- **`FormStepper` gains an `initialStep?: string` prop.** On mount it resolves the prop to a step index (matching `StepDef.key`), defaulting to 0 when absent or unmatched. Internal navigation is unchanged. `index` stays the single source of truth; the prop only seeds it.
- **Missing-required detection reuses the shared visibility evaluator.** `DocumentDetailView` computes empty visible required fields from the pinned form fields + current field values using the same `isFieldVisible` rule the wizard and submit gate use, so display, enforcement, and this prompt cannot drift. The prompt is gated by the same `canEdit` computed already present (DOC_CREATE + status DRAFT).
- **Focus is best-effort.** After the wizard mounts on the Details step, focus the first empty required field by its input id; if the element isn't found, do nothing (no error). Focus is a SHOULD, not a correctness requirement.
- **i18n.** Add keys under `documents` for the notice title, the missing-field list, and the button, in both `en` and `la` locales, per the project's no-hardcoded-copy rule.

## Risks / Trade-offs

- **Field metadata on Detail.** The Detail view must know each field's `isRequired`, `conditionJson`, `fieldName`, and label to compute what's missing. If the detail payload lacks any of these, we read them from the same form/field-value data the view already loads; if a required attribute is unavailable client-side, the notice simply won't list that field — the server still blocks the submit, so this fails safe (never a false "ready").
- **Step-key coupling.** The deep link uses the literal step key `details`. If wizard step keys are renamed, the link and the focus logic must move together; the fallback-to-first-step behavior keeps a stale link harmless.
- **Scope.** Frontend-only, additive; no CORE INVARIANT is touched. The only behavioral risk is a misleading notice, mitigated by reusing the shared visibility rule.

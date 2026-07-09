## Why

When a PROC is fully approved, the system auto-creates a DRAFT PO by copying the predecessor's header and line items — but NOT its form field values. Any field the PO's form marks required (e.g. `reason`) is therefore empty, so the submit-time required-field gate blocks it. Today the only path forward is: open the PO, click Edit, click through the wizard to the Details step, fill the field, save, then submit. The deep-linking friction is unnecessary and hides *why* the document can't be submitted.

We keep field entry manual on the successor (the buyer should state the PO's own justification, not silently inherit the requester's) — we only remove the navigation friction.

## What Changes

- On the document Detail page, a DRAFT document whose visible required form fields are still empty shows an inline notice listing the missing field labels.
- That notice carries a single action button that opens the edit wizard **landed directly on the Details step**, so the user goes straight to the fields that need completing instead of starting at the Type step.
- The edit wizard (`FormStepper`) gains the ability to start on a caller-specified step (via a route query), instead of always starting on the first step.
- No change to auto-create behavior, to what `createFrom` copies, or to the server submit gate. Field values are still NOT copied from the predecessor.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-documents`: the Document Detail gains a "complete required fields" affordance for drafts with missing required values; the Create/Edit wizard supports opening on a specified step via a deep link.

## Impact

- Frontend only. No backend, DB, or API change.
- `front-end/src/components/FormStepper.vue` — add an optional initial-step prop.
- `front-end/src/views/documents/CreateDocumentView.vue` — read the target step from the route and pass it to the stepper; focus the first empty required field.
- `front-end/src/views/documents/DocumentDetailView.vue` — compute missing visible required fields for a draft and render the notice + deep-link button.
- i18n: new keys under `documents` for the notice and button in `en` and `la` locales.
- No CORE INVARIANT is affected (purely a client-side navigation/UX aid; the server still enforces required fields at submit).

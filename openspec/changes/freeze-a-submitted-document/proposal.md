## Why

`PUT /documents/:id/fields` and `PUT /documents/:id/lines` accept a write at any status. A document that is waiting for a signature, or already approved, can have its field values and its line items rewritten by anyone holding `DOC_CREATE`.

The system already refuses this for one thing. `setPayee` is `DRAFT`-only, and its comment says why: *"the destination that passed the approval chain is the destination that gets paid, so once the document is submitted nobody — including finance — may redirect it."* That reasoning is not about bank accounts. It is about approval meaning something: an approver signs a document, and the document they signed is the one that takes effect.

Everything else the approver read is unprotected. The amounts on the lines, the reason for the request, the tracking number on a claim, the justification a manager approved — all rewritable after the fact, leaving an `approval_log` that says a person approved something, next to a document that no longer says what they approved.

The web app never does this: the Edit button is gated on `status === 'DRAFT'` and is the only way into the edit view. So the rule already exists, in the client, where CLAUDE.md says it does not count — *"the client guard is UX only; the server still enforces."* Here the server does not.

## What Changes

- `PUT /documents/:id/fields` and `PUT /documents/:id/lines` reject a write to a document that is not a `DRAFT`, the same way `PATCH /documents/:id/payee` already does, and with the same `INVALID_STATE` code an integration can branch on.
- A returned document is a `DRAFT` again, so the correct path for changing an approved document is unchanged and unsurprising: return it, edit it, submit it, and let the chain approve what it now says.
- Nothing else moves. Attachments stay writable at any status — an approver asking for another photo is a normal part of deciding, and a photo cannot change what was approved.

## Capabilities

### Modified Capabilities

- `document-engine`: a new requirement that a submitted document's field values and lines are immutable, stated the same way the payee's immutability already is.

### New Capabilities

None.

## Impact

- `back/src/modules/document/document.service.ts` — a status guard on two methods.
- No entity, migration, DTO, permission or endpoint change. No ledger write.
- **No web app change and no user-visible change.** The Edit button is already gated on `DRAFT`; this makes the server agree with the button rather than trust it.
- **A caller that edits a submitted document today will start receiving `400 INVALID_STATE`.** The claim guide already tells the one external integration to treat a submitted document as read-only, and warns this is coming. Any other caller doing it was relying on a gap.

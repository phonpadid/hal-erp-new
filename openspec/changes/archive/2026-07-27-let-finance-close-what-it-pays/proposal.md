## Why

Two things were left hanging once the business decided that ERP finance — not the claim system —
makes the transfer to the customer.

**Finance could not record what it paid.** Recording a settlement is gated on `PAYMENT_MANAGE`,
and of the seeded roles only `ADMIN` held it. The `FINANCE` role carried `DOC_VIEW`, `DOC_APPROVE`,
`BUDGET_VIEW` and `NOTIFICATION_VIEW` and nothing else, so the finance team got a `403` on
`GET /documents/unsettled` — the worklist built for them — and the only account that could close
out an approved compensation was the administrator. This was verified against a running server, not
inferred.

**A dropdown would not say what it accepted.** `GET /documents/types/:id/form` returned each
field's name, label, type and required flag, but not the values a `dropdown` permits. A caller told
to render a choice had two options: hardcode the values from a document, and drift the first time
one changed; or send something and find out at submit. This surfaced immediately — the claim form
gained a `LOST` / `DAMAGED` field and there was no way for the caller to discover those two words.

## What Changes

- The seeded `FINANCE` and `FINANCE_HEAD` roles gain `PAYMENT_VIEW` and `PAYMENT_MANAGE`.
  Deliberately **not** granted: `PAYMENT_SLIP_DELETE` and the batch permissions. A slip is the
  audit record of a payment; being able to record one is a different decision from being able to
  destroy the evidence of one.
- The form read carries `options` on a field that has them, parsed to an array of strings. The key
  is absent on every other field type, so its presence is itself the signal that a field is a
  choice. A row whose stored options cannot be parsed omits the key rather than failing the read —
  the caller still needs every other field on the form.
- The claim guide documents the key and tells the caller not to copy the values into its own code,
  which is the drift this read exists to prevent.

## Capabilities

### Modified Capabilities

- `platform-foundation`: the seeded baseline gives the finance roles the ability to record a
  payment, so a fresh install can complete a disbursement without the administrator.
- `document-engine`: the form read describes a choice field's permitted values.

### New Capabilities

None.

## Impact

- `back/src/seed/seed-data.ts` — two roles gain two permissions.
- `back/src/modules/document/document.service.ts` — the form read maps one more key.
- `back/src/modules/document/document-creatable.spec.ts` — two tests.
- `docs/claim-integration.md` — the key and how to treat it.
- No entity, migration, or endpoint change. Adding a key to a response cannot break a caller that
  does not read it.

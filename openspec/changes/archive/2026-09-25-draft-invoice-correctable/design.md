## Context

`SetVendorInvoiceDto` and `DocumentService.setVendorInvoice` are complete and `DRAFT`-gated; the
controller exposes them at `PATCH :id/invoice` behind `DOC_CREATE`. Nothing on the client calls it —
`grep` for a wrapper in `front-end/src/api/documents.ts` returns nothing, and `stores/documents.ts`
does not mention the invoice at all. `saveDraft` makes exactly three calls: `setSelections`,
`setFields`, `setLines`.

The wizard does restore both values (`headerFields` has `restore` entries for them), so a reopened
draft displays the invoice it holds. What is lost is any *edit*: the refs update, the Review step
shows the new value, the save resolves, and the document keeps the old one.

The controls carry no `:disabled`, unlike the selection pickers that now follow `selectionsLocked`.

## Goals / Non-Goals

**Goals:**

- A `DRAFT` document's supplier invoice can be corrected from the screen that shows it.
- The pair travels with the same save, under the same `DRAFT` rule, as the selections beside it.
- The edit path stops being a place where a header value can go missing.

**Non-Goals:**

- Any server change. The route is right; only the caller was missing.
- `moneyMovedOn` — same symptom, different fix, proposed separately.
- Relaxing the submit gate. A document claiming input VAT still needs both values; this change makes
  them suppliable, not optional.

## Decisions

**Carry it on `saveDraft`, as a fifth argument beside `selections`.**
The invoice is edited on the wizard's lines step and saved by the same button, so it belongs to the
same unit of work. `saveDraft` already sequences three calls; this is a fourth against a route that
exists. The alternative — calling `documentsApi.setVendorInvoice` directly from the view — would put
one of the save's writes outside the function whose job is the save, and outside its error handling,
so a failed invoice write would not turn the save red the way a failed selections write does.

**Send it on every draft save, not only when the fields are visible.**
`needsInvoice` is `accrues_on_approval && some line has a tax code`, which can go false while a
document still legitimately holds an invoice — remove a tax code and the fields hide. Gating the
send on visibility would then clear a stored invoice as a side effect of editing an unrelated line.
Sending the restored-or-edited refs on every save is idempotent when nothing changed and preserving
when the fields are hidden.

The corollary is that an empty ref clears the invoice, which is what the DTO's nullability already
means (*"Both nullable: clearing them is a valid edit"*). That is correct here: the refs are restored
from the document, so an empty one means the document had none or the user emptied it.

**Derive the payload from `headerFields`, as the selections payload now does.**
This is the third value to go missing from the hand-maintained edit path, after the payee and the
currency. The list exists so that a header value arrives in both directions or neither; the fix is to
use it, not to add one more name to a list that will be incomplete again. `INVOICE_KEYS` sits beside
`SELECTION_KEYS` and is checked against the wrapper's input type by the same `satisfies` annotation.

**Lock the two inputs on `selectionsLocked`.**
The server's rule for the invoice is the server's rule for the selections — `DRAFT` or refuse — so
the controls should follow the same computed rather than a second one that can disagree with it.

## Risks / Trade-offs

**One more request per draft save.** → Four small writes instead of three, against a local route, on
an action the user already waits for. Not batched, because batching would mean a new server endpoint
and this change deliberately touches no server code.

**A cleared invoice is now expressible from the UI.** Previously impossible (nothing was sent), so
this is new reach. → It is what the route was built for, it is `DRAFT`-only, and submit still refuses
a VAT-claiming document without one. A user who empties the field and saves gets exactly what they
asked for, and cannot submit until they refill it.

**Ordering against `setLines`.** `needsInvoice` depends on the lines' tax codes, so a save that adds
a tax code and an invoice at once writes both. → The submit gate reads the document's stored state,
not the request's, so the order within the save does not change what submit sees. Both are written
before any submit can observe them.

## Migration Plan

None. No schema change, no server change, no data backfill. Rollback is reverting the client; the
route it calls predates this change and stays as it is.

## Budget and quota sequencing

This change writes neither `budget_txn` nor `quota_usage` and takes no lock. `setVendorInvoice` is a
single `em.flush()` on one `document` row, refused outside `DRAFT` — which is before submit reserves
anything, so no reservation exists to race against.

## Open Questions

None.

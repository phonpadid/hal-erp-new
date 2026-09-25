## Context

`document.currency` is written once, in `DocumentService.create`, from `CreateDocumentDto.currency`
(`document.service.ts:297`). Nothing writes it again. `SetSelectionsDto` carries
`warehouseId`, `destWarehouseId`, `relatedEmployeeId`, `vendorId` and `vendorBankAccountId` and no
currency; the sibling routes (`PATCH :id/payee`, `PATCH :id/invoice`, `PUT :id/fields`,
`PUT :id/lines`) each own a different part of the document and none of them owns the header currency.

The client compounds it. `CreateDocumentView` keeps one `headerFields` list precisely so create and
edit cannot drift — its own comment says *"A field added here arrives in both directions or
neither"* — but only the create branch uses it (`...headerPayload()`); the edit branch builds a
separate `selections` literal by hand, and `currency` is not in it. The picker beside it stays
enabled, `docTotal`/`basePreview` recompute off the local ref, the Review step prints the new
currency, and `saveDraft` resolves successfully because the three calls it does make all succeed.
Nothing in that chain is wired to the currency, so nothing reports its loss.

A draft's FX state is trivial: `exchangeRate` is initialised to `'1'` at create and only
`DocumentSubmitService` (`:316`, `:617`) and `DocumentRateService` (`:107`) ever write it. `subTotal`,
`taxTotal`, `grandTotal` and `baseTotalAmount` are likewise written only at submit (`:623`–`:628`).
So on a draft there is no stamped rate and no derived base figure to keep consistent — correcting
the currency is a single scalar assignment.

## Goals / Non-Goals

**Goals:**

- A `DRAFT` document's currency can be corrected through the same route, permission code and company
  scope as its other type-driven selections.
- The correction is refused once the document has left `DRAFT`, and refused for a currency that
  could not have been chosen at creation, leaving the document unchanged.
- The web edit path actually sends it, and stops offering the picker where the server will refuse.

**Non-Goals:**

- Changing a submitted document's currency. That is a different act with a stamped rate, budget
  reservations and approvals already attached to it; `DocumentRateService` restates the *rate* of a
  submitted document under its own rules and is untouched here.
- Re-resolving or pre-resolving a rate on the draft. The advisory preview the wizard already shows
  is a client-side read and stays advisory.
- Recomputing `grandTotal` / `baseTotalAmount` on the draft.

## Decisions

**Put it on `PATCH :id/selections` rather than a new route.**
The currency is chosen on the same wizard step as the vendor and the payee, is saved by the same
button, and is subject to the same `DRAFT`-only rule. `setSelections` already resolves every
supplied value before assigning any of them, so a request naming a good vendor and a bad currency
leaves the document exactly as it was — a property a separate route would not share, and which
matters because the screen sends these together. The alternative, a `PATCH :id/currency` beside
`:id/payee`, would add a second round trip to one save and a second place for the edit path to
forget something.

The name on the DTO is `currency` (the ISO code, `@Length(3,3)`), matching `CreateDocumentDto.currency`
rather than the `...Id` convention of its neighbours, because the wizard holds a code and the create
DTO already takes a code. `requireCurrency` (`document.service.ts:1911`) resolves it.

**`given()` semantics, unchanged.**
`setSelections` distinguishes *absent* (leave alone) from *explicit null* (clear) via
`hasOwnProperty`. Currency follows the same rule with one difference: an explicit `null` is **not**
accepted. A document with no currency is one that falls back to the company base for every reading,
and a draft can already be created that way, but *clearing* a currency that a line's amounts were
entered against silently restates every one of those amounts in a different unit. The wizard never
sends it: its picker defaults to the base code and cannot be emptied. So `null` is refused rather
than quietly meaning "base".

**Validate against the same set the picker offers.**
`requireCurrency` resolves by code and throws `NotFoundException` for an unknown one, but does not
check `is_active`. The wizard's picker is filled from the active currencies, so an inactive currency
is not offerable at creation; accepting one here would let a correction reach further than the
creation it corrects, which is the rule the existing requirement states for warehouses, employees
and vendors. The check is added at the call site in `setSelections`, not inside `requireCurrency` —
`create` has its own behaviour and is not in scope for this change.

**Fix the client drift at its cause.**
Rather than adding `currency` to the hand-written `selections` literal — which leaves the next field
to be forgotten the same way — the edit branch derives its payload from the same `headerFields` list
the create branch uses, filtered to the keys the selections route accepts. The list already carries
a `send()` per key.

## Risks / Trade-offs

**A returned draft carries stale totals.** `grandTotal` and `baseTotalAmount` still hold the figures
stamped at the last submit, so between changing the currency and resubmitting, the documents list
shows the old base total under the new currency's document. → Pre-existing and not currency-specific:
editing a line's amount on a returned draft leaves the same staleness, and submit overwrites all of
them. Out of scope, but worth naming: it is why the fix must not stop at the detail screen looking
right.

**Currency changed without the amounts changing.** Switching LAK→THB on a draft reinterprets every
line amount in a new unit without touching the numbers — which is exactly the intended correction
for `REC-HAL-2026-0026` (14,000 was always THB), and exactly the wrong thing if the author meant to
convert. → The server cannot tell the two apart, and guessing would be worse. The wizard already
shows the advisory base preview recomputing live as the currency changes, which is where a converted
figure is visible before saving; the approval step is the control that catches a wrong amount, and it
already did four times on this document.

**Widening `SetSelectionsDto` widens what one request can change.** → Same route, same
`DOC_CREATE` gate, same `assertEditable` — the blast radius is a draft, which the same caller could
delete and recreate.

## Migration Plan

None. No schema change: `document.currency` exists and is nullable. No data backfill — existing
drafts keep the currency they have and become correctable. Rollback is reverting the code; nothing
written under the new behaviour is unreadable by the old (a draft whose currency was corrected is
indistinguishable from one created with that currency).

## Budget and quota sequencing

This change writes neither `budget_txn` nor `quota_usage`, and takes no lock. `setSelections` is a
single `em.flush()` on one `document` row; budget reservation happens at submit, from the currency
the document holds *at that moment*, through the existing `DocumentSubmitService` path and its
existing `PESSIMISTIC_WRITE` control-point locks. Correcting a draft's currency before submit
therefore changes which rate that reservation resolves at, and nothing about how it is taken. A
draft has no reservation to move.

## Open Questions

None blocking. One deliberate omission: the detail screen's stale post-return totals (see Risks) are
left as they are rather than folded into this change.

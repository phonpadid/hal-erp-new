## Why

A colleague chasing a document cannot see whose desk it is on, and the requester cannot see how
far it has got. Both were confirmed against live data.

Signed in as `Poupay` (STAFF) on `PO-HAL-2026-0001`, a document she may read but did not raise:

```
GET /documents?docNo=PO-HAL-2026-0001   200   the document is listed
GET /documents/<id>/approval-log        200   []      nobody has acted yet
GET /documents/<id>/can-act             200   {"canAct":false}
GET /documents/<id>/pending-approvers   404   "Document <id> not found"
```

**The refusal lies.** It says the document does not exist, to a caller who just read it three
times. What is withheld is one field of it. The client turns the 404 into `pending: null`, so the
screen shows a document that is `IN_APPROVAL` with an empty history and nothing at all about who
holds it, and the list's ຜູ້ອະນຸມັດຂັ້ນຕອນຕໍ່ໄປ column shows a dash for the same reason. To a reader
it looks broken and arbitrary: documents they raised show the entry, documents they did not do
not.

**The rule does not earn its cost.** The participant gate hides the approver's identity only
until someone acts — the moment an approval is recorded, the same reader sees that person's name
in the history. It conceals nothing durable, at the exact moment the information is useful:
while a colleague is trying to move the document along. The reader already sees the amount, the
lines, the attachments and who raised it.

**And the step number alone says nothing.** A requester sees `ຂັ້ນທີ 2`, which reads identically
whether the route has three steps or seven. "How far has it got" is the question the entry exists
to answer, and it answered half of it.

## What Changes

- The pending-step approver read is visible to any caller who may READ the document. Breadth is
  the caller's own `DOC_VIEW` scope and no wider: `OWN` sees their own documents, `DEPARTMENT`
  their department's, `COMPANY` the company's. Nothing reaches another company.
- A caller who may NOT read the document still gets `404 not found`, which is then true. That
  check moves to the document's own visibility rule (`DocumentService.assertVisible`) — which is
  what was silently missing, because the service loads the document with the company filter off
  and the participant gate was the only thing standing between it and any document id.
- The read returns `totalSteps`, the number of steps in the document's live recorded route, so
  the entry can read `ຂັ້ນທີ 2 ຈາກ 6`. It is already loaded to find the current step.
- The read stops resolving eligible actors for EVERY step. It needed that only to answer "is this
  caller a participant"; it now resolves the current step alone.

**No change** to who may act. `can-act`, the inbox and the approve path are untouched, and were
verified still refusing the same reader.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities

- `approval-workflow`: the Pending-Step Approver Read's visibility becomes document readability
  rather than participation; it gains the document-visibility check it was relying on the
  participant gate to provide, and returns the route's step count.
- `web-documents`: the detail timeline's pending entry is shown to every reader of the document
  and states the current step as a position within the route.

## Impact

`approval-routing.service.ts`, `approval.controller.ts`, `pending-approvers.spec.ts`,
`DocumentDetailView.vue`, `api/documents.ts`, `documents.detail.pending.*` in `en`/`la`/`zh`.

No migration, no new permission code, no client change to the visibility rule — the client
already renders the entry whenever the read returns one.

**Invariants**: invariant 1 is strengthened, not weakened — the endpoint previously had no
company-scope test of its own. Invariant 8 is untouched: this read grants nobody the ability to
approve anything.

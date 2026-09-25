## Why

A draft's currency cannot be changed. `currency` is accepted only on `CreateDocumentDto`; no route
on the document engine accepts one afterwards. The web edit wizard nevertheless shows the currency
picker enabled, recomputes the totals and the advisory base preview as the user changes it, and
reports `ບັນທຶກສຳເລັດແລ້ວ` on save — while the chosen currency never leaves the browser. The user is
told the change was saved, and it was not.

This is not hypothetical. `REC-HAL-2026-0026` is a rent disbursement for the Nong Khai branch paid
to a Thai bank account, raised in LAK. It has been returned to its author four times — *ຈຳນວນເງິນຜິດ*,
*ປັບປຸງ ຍອດເງິນ*, *ແປງຈໍານວນເງິນ*, *ຈຳນວນເງິນບໍ່ຖືກ* — and every attempt to answer by switching it to THB was
accepted by the screen and discarded by the server. A document whose currency is wrong by a factor
of ~690 cannot be corrected and cannot be approved; the only exit is to cancel it and lose its
number and its approval history.

## What Changes

- The document engine SHALL accept a change to `document.currency` while the document is `DRAFT`,
  on the same route, permission and company scope as the other draft-correctable selections
  (`PATCH /documents/:id/selections`, `DOC_CREATE`), and SHALL reject it once the document has left
  `DRAFT`.
- The currency named MUST be one that could have been chosen at creation — an active currency — so
  a correction cannot reach further than the creation it corrects. A currency that fails the check
  leaves the document unchanged, alongside the other selections in the same request.
- The web edit path sends the chosen currency on save, which it does not today: the edit branch
  hand-enumerates its selections payload instead of reusing the wizard's `headerFields` list, so the
  currency is dropped between the picker and the request.
- No change to how the rate is obtained. A draft carries `exchange_rate = 1` and the authoritative
  rate is resolved and stamped at submit; correcting a draft's currency only changes which currency
  that submit will resolve from.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `document-engine`: *A Draft's Type-Driven Selections Can Be Corrected* extends to
  `document.currency` — which currencies are acceptable, and that the change is refused outside
  `DRAFT`.
- `web-documents`: *Create and Edit a Draft* states that the currency picker persists on save in the
  edit path as well as the create path, and that it is disabled once the document has left `DRAFT`
  rather than offering a change the server will not take.

## Impact

Touches **document-engine** (server) and **web-documents** (client). Both are downstream of
**multi-currency**, which is unchanged: no new rate resolution, no new rate storage.

- `back/src/modules/document/dto/document.dto.ts` — `SetSelectionsDto` gains `currency`.
- `back/src/modules/document/document.service.ts` — `setSelections` resolves and assigns it.
- `front-end/src/api/documents.ts` — `DocumentSelections` gains `currency`.
- `front-end/src/views/documents/CreateDocumentView.vue` — the edit branch sends it; the picker is
  disabled once the draft has left `DRAFT`.

**Invariant 6 (locked FX) is not weakened.** The rate is stamped at submit and never recomputed;
this change touches only which currency a *draft* names, before any rate exists. A submitted
document's currency stays untouched — the existing restatement path (`DocumentRateService`) remains
the only way to move a stamped rate, and it is unchanged here.

**Invariant 1 (company isolation)** holds: the write goes through the same active-company scope as
the other selections.

No migration. `document.currency` already exists and is already nullable.

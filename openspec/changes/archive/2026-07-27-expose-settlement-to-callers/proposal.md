## Why

The ERP records when a compensation was actually paid — the date, the reference, the evidence — and no caller can read any of it. The claim system polls `GET /documents/:id`, sees `COMPLETED`, and has to stop there: `COMPLETED` means "fully approved", not "paid", so it cannot tell its customer the money has gone.

They asked for it after reading the guide, and asked for the smallest useful thing: the date and the reference, not the evidence. That is the right shape — the slip is an audit artefact for our finance team, and handing an external system a link to it would be answering a question nobody asked.

It is also worth doing whichever way the open question lands. If our finance operates the transfer, this read is how the claim system closes its case. If theirs does, the same read is how they reconcile what we recorded against what they paid. Neither answer makes it wasted work.

## What Changes

- A read that answers "has this been settled, and when": `GET /documents/:id/settlement`, returning the settlement type, the date the money left, and the reference — or `404` when the document has not been settled.
- The existing document reads are **not touched**. `GET /documents/:id` keeps returning exactly what it returns today, and so does `/detail`. A caller polls for status as it does now and asks this once, when the status says it is worth asking.
- Readable with the same permission the rest of the document is read with, so the claim system's existing key needs nothing new.
- The claim guide gains the call and the shape.

Deliberately **not** in this change: the evidence file, the actor who recorded it, and anything on the payable it cleared. Those are ours; the caller asked for two fields and two fields is what a contract should carry.

## Capabilities

### Modified Capabilities

- `document-engine`: a new requirement that a settled document can be read back as settled by a caller entitled to read the document.

### New Capabilities

None.

## Impact

- `back/src/modules/document/settlement.service.ts` — one read method.
- `back/src/modules/document/document.controller.ts` — one endpoint.
- `docs/claim-integration.md` — the call, and removal of the "not yet exposed" note.
- No entity, migration, DTO, or permission-code change. No existing response shape changes, which is the point: an added endpoint cannot break a caller that does not call it.
- No ledger write of any kind. This is a read.

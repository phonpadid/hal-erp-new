## Context

`document_settlement` holds one row per settled document: the settlement type, the day the money left, the reference, who recorded it, a note, and — through `document_attachment` — the evidence. Nothing reads it back out. The finance queue (`GET /documents/unsettled`) is the only thing that touches it, and it answers the opposite question.

The claim system polls `GET /documents/:id` for status. `COMPLETED` is where its polling ends today, and `COMPLETED` means approved.

## Goals / Non-Goals

**Goals:**
- A caller entitled to read a document can find out whether it has been settled, and when.
- Nothing an existing caller receives changes.
- The claim system needs no new permission on its key.

**Non-Goals:**
- Exposing the evidence. The slip is for our audit; a caller asked for a date and a reference.
- Exposing who recorded it. That is an internal accountability record, and naming our finance staff to an external system is a disclosure nobody requested.
- A settlement list or filter for external callers. The finance queue is ours.
- Push. There is still no webhook, deliberately.

## Decisions

**A separate endpoint, not a field on `GET /documents/:id`.**

The obvious move is to add `settlement` to the document read, and it is the one I rejected. `get()` returns the MikroORM entity and Nest serialises it; spreading it into a new object to attach a field bypasses whatever `toJSON` the entity chain defines, and the shape a hundred existing callers depend on would be produced by a different code path than it is today. That is exactly the kind of "small additive change" that turns out not to be.

A new endpoint cannot break a caller that does not call it. The cost is one extra request, made once, only when the status says it is worth making — for a low-volume flow where nothing changes faster than a person can sign something, that is not a cost worth trading correctness for.

*Alternative — add it to `/detail`.* Rejected for the same reason at a smaller scale, and because `/detail` is the heavy read: a caller that wants two fields should not have to fetch every field value, line and attachment to get them.

**`404` when unsettled, not `200` with nulls.**

"This document has no settlement" is the absence of a thing, and the caller's next action is the same as for any other absence: come back later. A `200 { "settledAt": null }` invites a caller to treat null as a value and forget the case is still open.

*Alternative — `200` with a `settled: false` envelope.* Rejected as a second way to say what the status code already says.

**The same permission as reading the document.**

`DOC_VIEW`. A caller that may read the document may know whether it was paid — the fact is about the document, not about our finance team. It also means the claim system's key needs nothing added, which is the difference between this shipping with the integration and shipping after another round of key changes.

**Three fields, and no more.** `settlementType`, `settledAt`, `reference`. The note is internal, the actor is internal, the attachment is internal. A contract that carries only what was asked for is a contract that can grow later; one that leaks everything available can only shrink, and shrinking is the breaking change.

**No transaction, no lock, no ledger write.** A read.

## Risks / Trade-offs

**A caller could poll this endpoint instead of the status one** and get `404` repeatedly until the day it succeeds → cheap, but wasteful and easy to avoid: the guide says to poll status and ask this once `COMPLETED` appears. Worth saying rather than assuming.

**`404` is also what an unknown or cross-company document id returns** → a caller cannot distinguish "not settled" from "not yours", which is the correct amount of information to give about another company's document; for its own documents the distinction is not one it needs, because it knows the id it created.

**The open question about who transfers the money is still open** → this read is useful under both answers, which is why it is worth building before the answer arrives rather than after.

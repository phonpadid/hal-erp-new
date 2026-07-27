## Context

Two facts about the current code decide the shape of this change.

**A document carries no trace of where it came from.** `document` has `ref_document_id` (a predecessor *in this system*) and `related_employee_id` (a person *in this system*). Neither can hold "claim CLM-B-8842 in the other system". So a second call carrying the same claim is indistinguishable from a genuine second claim.

**A document number is committed before the document exists.** `NumberingService.next()` runs `inTransaction(...)`, takes `LockMode.PESSIMISTIC_WRITE` on `doc_running_number`, increments, and commits — in its own transaction, deliberately, so the lock is not held for the rest of the create. `createDraft` then builds the entity and flushes separately. A failure after numbering therefore burns a number.

```
   createDraft today
   ─────────────────────────────────────────────────────────
   resolve dept_doc_type  →  build prefix
        │
        ▼
   numbering.next()        ← own transaction · commits the increment
        │
        ▼
   em.create(Document) + flush
        │
        └── if this fails, the number is gone
```

That ordering is why the duplicate check has to happen at the top, not as a database constraint alone: a constraint would catch the duplicate only after a number had already been spent on it.

The pattern to copy is in the same schema. `journal_entry` is unique on `(company_id, source_type, source_id)` and its note says exactly why: *"Idempotent per source (source_type + source_id) so event retries never double-post."* Documents created from outside need the same key for the same reason — with higher stakes, because a duplicated document reserves budget the moment it is submitted, and `budget_txn` is append-only, so the correction is a compensating `RELEASE` rather than a delete.

## Goals / Non-Goals

**Goals:**
- A retry carrying the same external identifier produces one document, one reservation, one approval.
- The retry still receives the document id, so the caller can continue its own flow without a special case.
- Two concurrent retries cannot both create a document, even if both pass the lookup.
- Documents raised in the web app are untouched.

**Non-Goals:**
- Idempotency for anything other than creation. `submit`, `cancel`, and field writes are separate operations with their own semantics; nothing here changes them.
- Reconciling a payload that differs from the first call under the same identifier. See Decisions.
- Any change to approval, budget, quota, or the claim document type. Those are later changes.
- Removing the possibility of a numbering gap entirely. See Risks.

## Decisions

**Two columns, not one composite string.** `source_type` names the system or feed (`'CLAIM'`), `source_id` holds that system's own identifier. Splitting them mirrors `journal_entry` exactly, keeps the index usable for "everything that came from this feed", and avoids a delimiter that will eventually appear inside an identifier.

*Alternative — a single `external_ref` string.* Rejected: it collapses two questions ("which system" and "which record") into one value, and every consumer would have to re-split it.

**The key is scoped by company.** `(company_id, source_type, source_id)` — the same triple `journal_entry` uses. Invariant 1 says every main table is scoped by company, and two companies can legitimately receive feeds that number their records from 1.

**A duplicate returns the existing document, it does not fail.** The caller's second request means "make sure this exists", and it already does. Returning `409` would force every integration to special-case a response that means success, and the most common trigger — a timeout where the first call actually succeeded — is precisely the case where the caller has no id and needs one.

*Alternative — return `409 Conflict`.* Rejected for the reason above. A conflict is the right answer when two *different* things collide; here they are the same thing.

**The lookup happens before a number is issued.** First statement in `createDraft`, before `numbering.next()`. On the ordinary retry path no number is consumed and no row is written.

**The database enforces it too, with a partial unique index.** `(company_id, source_type, source_id) WHERE source_id IS NOT NULL`. The lookup handles the common case; the index handles the race where two retries arrive together and both miss. On a unique violation the service re-reads by the same key and returns the winner's document, so the loser's caller still gets a correct answer rather than a 500.

*Alternative — rely on the service lookup alone.* Rejected: check-then-insert without a constraint is a race, and this race writes money-bearing rows.

**The index is declared on the entity, not only written in the migration.** Found while writing the concurrency test, which created two documents and passed: specs build their schema with `orm.schema.refreshDatabase()` from entity metadata, while production builds it from migrations. An index that lives only in a migration therefore exists in production and **not** in any test — so the constraint protecting the budget would have been the one thing no test could exercise. It is declared with `@Index({ name, expression })` carrying the raw partial-index SQL, which both schema paths then produce. The migration keeps its hand-written statement so an already-migrated database gets it too.

*Alternative — take an advisory lock on the key.* Rejected as heavier than the problem: the unique index already serialises the only moment that matters, and the losing side's recovery is a single re-read.

**A differing payload under the same identifier is ignored.** The existing document is returned unchanged; the new field values are not applied. Two reasons: a retry is by definition the same request, so a difference means the caller is misusing the key rather than retrying; and silently mutating a document that may already be submitted, approved, or paid would be far worse than ignoring the input. If a claim's amount genuinely changes, that is a returned document or a new claim, not a re-`POST`.

**Both columns stay optional and nothing infers them.** No default from the API key, no derivation from the authentication source. A caller that wants idempotency asks for it explicitly; every existing caller is unaffected because it sends neither.

**No transaction boundary changes and no lock is added.** This change writes no `budget_txn` and no `quota_usage` — it reads, and on the create path it writes the same single `document` row `createDraft` already wrote. `numbering.next()` keeps its own pessimistic lock exactly as it is.

## Risks / Trade-offs

**A concurrent retry can burn a document number** — both callers pass the lookup, both take a number, one insert loses to the unique index and its number is never used, leaving a gap in that type's sequence → accepted, and narrow: it needs two retries overlapping inside the window between the lookup and the insert. Closing it entirely would mean allocating the number inside the document's transaction, which would hold the `doc_running_number` lock across the whole create and serialise every document creation in the company — a much worse trade for a gap that Thai document numbering already tolerates when a create fails for any other reason.

**A caller could reuse an identifier for a genuinely different claim** — it would receive the old document and believe the new one was recorded → the identifier is the caller's own primary key, so reuse is a bug on their side; the integration agreement should state that `source_id` is immutable and unique per claim, and the returned document's fields let the caller detect a mismatch if it checks.

**The partial index only covers rows where `source_id` is set** — documents created in the web app remain unconstrained, as intended, but that also means nothing stops a future caller from sending `source_type` without `source_id` → validate the pair together: both present or both absent, rejected at the DTO.

**The claim integration is not the only future consumer** — naming the columns `source_type`/`source_id` rather than something claim-specific is what keeps the next feed from needing its own mechanism, but it also means the values are only as disciplined as whoever sets them → the value belongs to the caller and is opaque to us; that is the same contract `journal_entry` already lives with.

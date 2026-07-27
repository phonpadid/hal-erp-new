## Why

An external system is about to start creating documents through the API — a damaged-parcel claim system that owns the case (intake, inspection, valuation) and hands us the part we own: approval, budget, and accounting. It will call `POST /documents` over HTTP, and HTTP retries.

`document` carries no external reference. Every retry after a timeout creates a second document, and — because a claim is submitted immediately after creation — a second `RESERVE` against the same budget. The caller cannot tell the two apart, and neither can we: nothing on the row records which claim it came from.

The correction is worse than the duplicate. `budget_txn` is append-only, so an accidental reservation cannot be deleted; it has to be answered with a compensating `RELEASE`, by someone who first notices the budget draining faster than the claims justify. A timeout — the most ordinary failure on the internet — silently consumes the budget twice and leaves a mess only a human can unpick.

The system already knows how to solve this. `journal_entry` is keyed `(company_id, source_type, source_id)` so that, as its own note says, *"event retries never double-post."* Documents need the same key for the same reason.

## What Changes

- `document` gains an optional external source: `source_type` (which system) and `source_id` (that system's own identifier for the thing), unique per company when present.
- `POST /documents` accepts them. When a document already exists for the same `(company, source_type, source_id)`, the endpoint returns **that document** instead of creating a new one — the retry becomes a no-op that still gives the caller the id it needs.
- The pair stays optional. Documents raised in the web app carry neither and are unaffected; nothing about existing behaviour changes for them.
- The uniqueness is enforced by a partial unique index in the database, not only in service code, so two concurrent retries cannot both pass a check-then-insert.

Deliberately **not** in this change: nothing about approval, budget, accounting, or the claim document type itself. This is the one piece that must exist before any external system is allowed to create documents at all.

## Capabilities

### Modified Capabilities

- `document-engine`: a new requirement that a document may record the external source it originated from, and that creating a document for a source that already has one returns the existing document rather than creating another.

### New Capabilities

None.

## Impact

- `erp_approval_system.dbml` — two columns and one index on `document`.
- `back/src/migrations/` — one additive migration: two nullable columns plus a partial unique index. No existing row changes; every current document simply has both columns null.
- `back/src/modules/document/document.entities.ts` — two optional properties.
- `back/src/modules/document/dto/document.dto.ts` — two optional, validated fields on `CreateDocumentDto`.
- `back/src/modules/document/document.service.ts` — a lookup before `createDraft` issues a number, and a race-safe handler for the unique-violation path.
- No change to the approval chain, the budget ledger, the quota ledger, permission codes, or company scoping. Every invariant in CLAUDE.md holds unchanged: this adds an idempotency key and returns an existing row, and writes nothing to `budget_txn` or `approval_log` that it did not write before.
- Callers that do not send the pair see no difference at all.

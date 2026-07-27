## Why

Three things were being carried as open questions. Two turned out to be defects wearing the costume
of a decision, and the third turned out to need no work at all.

**A dropdown was decoration.** `GET /documents/types/:id/form` advertised a field's permitted
values, and the write stored whatever string arrived. Nothing checked one against the other. So the
form could say "choose CASH or GOODS", a caller could send either, and only `CASH` could actually
be settled — a `GOODS` claim approved, raised a payable in the ledger, and then hit
`"only CASH can be recorded"` at settlement, leaving a liability with no way to clear it and a
document with no way to finish. The value was refused three steps after it should have been.

This was framed as "GOODS is not implemented yet". It is better read as: the system offered a
choice it could not honour, and had no mechanism that would have stopped it.

**A stranded document was silent.** If a workflow's lowest band starts above a document's amount,
no step applies. The document stays SUBMITTED forever, holding the budget it reserved, and no
approver is ever notified. This landed in the same `catch` as the harmless "already routed" case
and was logged at `debug` — a level that is off by default, so it was not logged at all. The only
protection was a warning written in a document for humans to remember.

**A per-claim ceiling.** Investigated and deliberately not built — see below.

## What Changes

- **A value written to a field that offers a fixed set must be one of them.** Enforced generically
  from the field's own options, with no document type named anywhere: the configuration is the
  rule, as it is for `document_type` flags and `workflow` bands. Refused before anything is
  written, so a batch containing one bad value leaves the document untouched rather than half
  updated. An empty value still clears the field — whether it was allowed to be empty is the
  required-field check at submit. A field whose stored options cannot be parsed is not enforced,
  the same choice the form read already makes: one malformed config row must not become an outage.
- **`GOODS` is removed from the CLAIM form**, published as a new form version. With the rule above
  it is now refused at `PUT /:id/fields` — before the budget is reserved and long before a payable
  exists.
- **A stranded submit is reported as an error**, naming the document, saying that budget is being
  held, and saying what to fix. The benign case stays quiet.
- **No per-claim ceiling.** The ERP's controls are the budget and the approval chain, and the chain
  already escalates with the amount — a claim large enough to matter reaches a person who can see
  it is wrong. A fixed cap would be a third control catching nothing the second does not, that
  someone would have to keep in step with the bands forever. The real exposure is that a wrong
  amount holds budget until a human rejects it; that is now written down for the caller, along with
  the cancel that releases it immediately.

## Capabilities

### Modified Capabilities

- `document-engine`: a new requirement that a choice field only accepts what it offers.
- `approval-workflow`: a new requirement that a document no step applies to is reported rather
  than silently left.
- `platform-foundation`: a new requirement that a DB-backed spec which clears a shared table
  builds its own schema instead of inheriting one.

### New Capabilities

None.

## Impact

- `back/src/modules/document/document.service.ts` — one guard before the field write.
- `back/src/modules/approval/approval-submitted.listener.ts` — two outcomes instead of one.
- `back/scripts/setup-claim-dev.ts` — `settlementKind` offers `CASH`; the script now publishes a
  new form version when a field's OPTIONS change, not only when a field is missing.
- Two new specs, one of them database-free.
- `back/src/modules/rbac/signature.spec.ts`, `profile-image.spec.ts` — each builds its own schema.
  Both cleared `app_user` without one, so a document left by an earlier run failed eleven tests
  with a foreign-key error naming nothing they test.
- `docs/claim-integration.md` — the refusal, the removal of `GOODS`, and the ceiling decision.
- No entity or migration change. Existing documents keep the form version they were created
  against, so nothing in flight is revalidated.

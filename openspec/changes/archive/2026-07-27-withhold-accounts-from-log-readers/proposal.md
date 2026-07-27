## Why

`GET /documents/:id/approval-log` returned the populated `AppUser` entity. `AppUser.passwordHash`
was an ordinary property, so every read of the log serialized a live bcrypt hash — alongside the
approver's email, account status and verification timestamp.

The claim integration guide instructs an external system to poll exactly this endpoint: once for
the reason a claim was rejected, and once more to tell a returned document from one that was never
submitted. The approval log is the only approval route an API key is permitted to walk. So the
hash was not merely exposed internally — it was on the documented path out of the company.

Nothing else leaked. `GET /documents/:id`, `/detail`, `/pending-approvers`, `/creatable-types` and
`/unsettled` were all checked against a running server and are clean. But the hole was in the
entity, not in the controller, so any future endpoint that populates a user and returns it would
have leaked the same way without anyone noticing.

## What Changes

- `AppUser.passwordHash` becomes hidden from serialization. This closes every present and future
  endpoint at once. Services read the property off the object directly and are unaffected —
  hiding a property changes only what `toObject()`/`toJSON()` emit.
- The approval log returns a shape written down in the controller rather than whatever the entity
  happens to carry. An approver is an id and a username. The nested document and the stamped
  signature id, which were also riding along, go with it.
- The claim guide quotes that shape as the contract, so a caller can see what it is entitled to
  rather than infer it from a sample response.

Two fixes rather than one, because they answer different questions: the entity is the net, and the
endpoint is the promise. The net alone would leave the log free to widen again; the promise alone
would leave the next endpoint to rediscover the hole.

## Capabilities

### Modified Capabilities

- `approval-workflow`: a new requirement that reading a document's approval history identifies
  approvers by name and id and carries no account material.
- `rbac`: a new requirement that a user's stored password hash is never serialized into a
  response.

### New Capabilities

None.

## Impact

- `back/src/modules/rbac/rbac.entities.ts` — one property gains `hidden`.
- `back/src/modules/approval/approval.controller.ts` — the log handler maps its result.
- `back/src/modules/approval/approval-log-shape.spec.ts` — new, database-free.
- `docs/claim-integration.md` — the response shape and what will never appear in it.
- No migration: hiding a property is a serialization concern, not a schema one.
- The frontend reads `action`, `approver.username`, `actedAt` and `remark`, all of which survive.

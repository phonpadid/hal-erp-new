# Design

## D1. The projection is the same one the accounting log uses

`AccountingPeriodService.log()` already returns
`{ id, action, actedAt, reason, actedBy: { id, username } }`. Making this endpoint return the same
shape means two audit logs in the same product answer the same question the same way, and a reader
who has seen one can read the other.

The alternative — marking `email` as `hidden` on `AppUser` — is wrong twice over. It would change
every endpoint that legitimately returns a user's email (the profile screen, the employee admin
list), and it treats a field's visibility as a property of the field rather than of the read. What a
period's audit trail should say about an actor is a decision belonging to the audit trail.

## D2. An id and a username, not a display name

The row identifies who acted. `username` is unique and stable; `Employee.fullName` is neither
guaranteed to exist for every `AppUser` nor stable over time, and joining to it would make the audit
read depend on the employee registry.

The id is kept alongside so a caller can link elsewhere without matching on a name.

## D3. Nothing changes on the client, and that is the check

The api client types `actedBy` as `{ id, username }` and the detail view reads `username`. If this
change required a client edit, the projection would have been wrong.

So "the client compiles and its tests pass, untouched" is the evidence that the narrow shape was
always the intended contract — the server was returning a superset nobody asked for.

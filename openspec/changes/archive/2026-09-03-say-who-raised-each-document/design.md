## Context

Three facts decide this.

**The name already has a definition, and it is not the username.** `detail()` resolves the requester
as the creator's `employee.full_name` in the document's company, falling back to `app_user.username`.
The PDF proposer resolution does the same. A list that printed the username alone would name the
same person differently on the two screens a reader moves between.

**Populating the relation is already ruled out.** The comment above that resolution says why: it
would serialize the whole `AppUser` — `passwordHash` included — into the response. `detail()`
therefore reads partials (`fields: ['fullName']`, `fields: ['username']`) rather than populating.

**`list()` returns raw entities.** `paginate(em, Document, where, …)` hands the rows straight out, so
`created_by` is already crossing the wire as a bare uuid. Adding a name is also an opportunity to
stop doing that.

## Goals / Non-Goals

**Goals:**

- The list names who raised each document, by the same rule as the detail.
- Two queries per page regardless of page size.
- No user identifier and no user field beyond the name leaves the server.

**Non-Goals:**

- Filtering or sorting by requester. The `mine` filter already covers "documents I raised", and a
  requester filter needs a picker, a query parameter and a spec of its own.
- Any change to who may see which document. This change adds a column to rows already visible.

## Decisions

### D1. `requesterName`, resolved the way `detail()` resolves it

Same field name, same rule, same fallback. A reader who opens a row from the list must not see the
name change. The alternative — a `createdBy: { id, username }` object like the detail's document
header carries — would ship an id the list has no use for and a username the detail does not print.

### D2. Batched, and the batch is scoped

Two reads per page: every employee whose `user` is one of the page's creators **within the document's
own company**, then the usernames of whatever creators that did not match. The company scoping is not
incidental — a user may be an employee in several companies of the group, and the name shown must be
the one belonging to the company whose document is on screen.

Per-row resolution would be 2N queries for a 20-row page and would have to be forbidden by review
rather than by construction; batching makes the cheap thing the only thing.

### D3. The raw `createdBy` stops being returned

Not a separate cleanup: the row is being reshaped anyway, and leaving a bare user id next to a
resolved name invites a client to key on it. The list has no read that needs the id — the "mine"
filter is applied server-side from the request context.

### D4. A secondary column

`data-priority="secondary"`, beside Created and Next approver, so the responsive rules the list
already has collapse it on narrow screens instead of pushing the document number off the row.

## Risks / Trade-offs

- **A creator with no employee record shows a username**, which is an internal-looking string next to
  Lao names. Accepted: it is what the detail already shows, and inventing a nicer fallback would make
  the two screens disagree again.
- **A page whose creators are all distinct costs one row per creator in the employee read.** Bounded
  by the page size, which is bounded by the paginator.

## Migration Plan

None. No schema change, no data change, no migration.

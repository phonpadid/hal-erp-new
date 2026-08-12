# Design

## D1. The fiscal-year list moves to the period controller, because the guard is AND

`RequirePermissions` collects codes and `PermissionsGuard` checks
`required.every((code) => granted.has(code))`. There is no OR. So
`@RequirePermissions(FISCAL_YEAR_MANAGE, PERIOD_MANAGE)` would demand **both**, which is stricter
than today and helps nobody.

Three ways out, and the choice matters more than it looks:

- **(a) Teach the guard OR.** One screen's convenience, paid for by changing how every endpoint in
  the system is authorized. An `anyOf` next to `every` is the kind of primitive that gets reached
  for once and then everywhere, and "which of these codes did this endpoint actually need" stops
  being answerable by reading one line.
- **(b) Loosen `GET /fiscal-years` to a code both roles hold.** There isn't one, and inventing a
  `FISCAL_YEAR_VIEW` to be granted to two roles moves the problem into the seed and the RBAC screen.
- **(c) Put the read where its caller lives.** `GET /accounting-periods/fiscal-years` under
  `PERIOD_MANAGE`.

**(c).** It needs no new authorization concept, and it is a more honest endpoint: it does not answer
"what fiscal years exist" — an organisation-administration question — but "which years may I declare
a period into", which is a period question, asked by the period screen, gated by the period code.

The precedent is already in the codebase: `accounts/selectable`, `quota/selectable`,
`tax-codes/selectable-vat` are all narrowed reads that exist because the full list is gated for a
different audience.

**Only OPEN years.** A closed fiscal year cannot take a new period — its result has already been
rolled into retained earnings — so offering one would produce a declare that should be refused.
Filtering here is not hiding a rule; it is not offering a choice the system will reject.

## D2. The log returns a projection, and the actor is a username

`accounting_period_log.acted_by` is an `AppUser`. Populating and returning the entity would put
`email` on the wire — `passwordHash` is `hidden` and safe, but email is not, and an audit panel
needs a name, not a contact.

So the endpoint returns `{ id, action, actedAt, reason, actedBy: { id, username } }`.

The neighbouring `GET /attendance-periods/:periodId/log` does populate and return the whole entity.
That is the precedent, and this deviates from it deliberately: a narrower projection is the right
shape for a read whose only job is to say who did what, and copying the wider one would spread a
choice nobody made on purpose. Not changing the attendance endpoint here — it is a different
capability, and a drive-by edit to it would be unreviewable in this change.

## D3. `PERIOD_VIEW`, not a management code

Reading the log is the auditor's act, and an auditor reads. `PERIOD_VIEW` already gates the list the
log hangs off, so anyone who can see that a period was reopened can see who reopened it and why —
which is the point of recording it.

Gating it behind `PERIOD_MANAGE` or `PERIOD_REOPEN` would mean the only people who can read the
audit trail are the people it exists to hold accountable.

## D4. The screen keeps the "unavailable" message for the case that still exists

The declare dialog stops saying the fiscal-year list is unavailable, because for a `PERIOD_MANAGE`
holder it no longer is.

But a company with **no open fiscal year** is a real state — the year was closed and the next one
not yet created — and it needs its own sentence. An empty selector is what this change exists to
avoid; replacing "you lack a permission" with a silently empty dropdown would land in the same
place by a different route. So the empty case says the company has no open fiscal year, which points
at the org-admin screen rather than at a permission.

## D5. The log is loaded per period, not with the list

The list endpoint returns every period and the log endpoint takes one id. Loading logs eagerly for
twelve periods to render one panel is eleven queries nobody asked for.

The panel therefore fetches on open, like the close dialog fetches coverage on the attendance
screen. The store holds the log for the period currently shown, not a map of all of them — a cache
keyed by period would have to be invalidated on close and reopen, and there is nothing to gain from
it on a screen with twelve rows.

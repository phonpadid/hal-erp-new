## Why

A freshly migrated production database cannot be logged into. `seed:prod` deliberately writes
only permissions, currencies and notification templates — no company, no roles, no accounts —
and the demo seeder that would create them is refused outright when `NODE_ENV=production`,
because its accounts share a password committed to this repository. Every other way in is
closed too: account creation requires a permission, which requires a token, which requires an
account. There is no public registration endpoint and no `@Public()` route that creates one.

The result is a chicken-and-egg lock that the deploy cannot break and that no document records
how to break. This is not hypothetical — it is the current state of production.

## What Changes

- A new one-shot command, `pnpm --filter back bootstrap:admin`, creates the minimum set of rows
  a person needs in order to sign in and administer the system: one company, one department,
  one `ADMIN` role wired to the full permission catalog, one account, and the membership that
  binds them.
- The command reads its identity and credentials from the environment and **fails closed** when
  any of them is absent. No default username, no default password, nothing to guess from the
  repository.
- The command **refuses to run when the database already holds an account**, so it is a
  bootstrap and not a standing back door. Re-running it on a populated database is an error,
  not a no-op.
- The command is run **by hand, once, per environment**. It is never added to the deploy.
- `back/README.md` gains the first-run procedure that currently exists nowhere.

## Capabilities

### New Capabilities
- `production-bootstrap`: how a production database goes from "migrated and seeded" to "a person
  can sign in": what the bootstrap creates, what it demands as input, when it must refuse, and
  why it is not part of any automated pipeline.

### Modified Capabilities
- `deployment-pipeline`: the existing prohibition on the deploy running the demo seeder is
  widened — the deploy SHALL NOT run any command that creates a login account, the bootstrap
  included. A deploy that can mint an administrator is a deploy that can mint one silently.

## Impact

**Code**
- New `back/scripts/bootstrap-admin.ts` (sibling to `seed-essentials.ts`, `permissions-sync.ts`).
- New `back/src/seed/bootstrap-admin.ts` holding the logic, so it is testable without a shell.
- New `bootstrap:admin` script in `back/package.json`.
- `back/README.md`: first-run procedure.

**Data** — writes `company`, `department`, `role`, `role_permission`, `app_user`,
`user_company_role`. No new tables; no DBML change. No append-only ledger rows (invariant 2).

**Depends on** `seed:prod` having run first: the role grant reads the `permission` catalog, and
the company's base currency is an existing `currency` row.

**Invariants**
- Invariant 1 (company isolation): the bootstrap creates exactly one company and scopes the
  role, the membership and every grant to it. It never writes across companies.
- Invariant 6 (permission codes, not role names): the `ADMIN` role is a per-company label; its
  authority comes from the `role_permission` rows carrying permission codes, which is what the
  bootstrap actually writes.

**Not in scope** — no HTTP endpoint. Bootstrapping over the network is how a bootstrap becomes a
back door; this stays on the machine that already has database credentials.

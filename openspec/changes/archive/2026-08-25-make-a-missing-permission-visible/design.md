## Context

Three routes redirect to the home page for every user in this installation, `admin` included, and
nothing anywhere says why. The capability behind one of them — closing an accounting period — is
fully built: `AccountingPermissions` declares `PERIOD_VIEW` / `PERIOD_MANAGE` / `PERIOD_CLOSE` /
`PERIOD_REOPEN`, `accounting-period.controller.ts` guards on them, `routes.ts:237` routes to the
view, and the backend suite covers it. It is unreachable because the `permission` table holds no
row for those codes, and a code with no row cannot be granted to anybody.

The catalog machinery is not the problem. It is complete and correct:

| Piece | Where | State |
|---|---|---|
| declared codes, one source | `seed-data.ts:103` `allPermissionCodes()` | includes all 12 missing codes |
| reconcile | `permissions:sync` → `syncPermissionCatalog` | additive, writes only `permission` |
| read-only check | `permissions:check` → `missingPermissionCodes` | exits non-zero, names the codes |
| deploy wiring | `.github/workflows/deploy.yml:142-143` | sync then check, after `migration:up` |

An archived change, `2026-07-26-sync-permission-catalog-on-deploy`, built all of it, and its
proposal names the exact failure being seen now — "a 403 nobody can explain".

The gap is the path the deploy never touches. This installation's database is a restore from
production, and a restore carries the rows it carried; it does not run a pipeline. Measured against
the source:

```
declared 75 · present 63 · missing 12
BANK_ACCOUNT_MANAGE  BANK_ACCOUNT_VIEW  GL_JV_APPROVE  GL_JV_POST  GL_POST_RETRY
PERIOD_CLOSE  PERIOD_MANAGE  PERIOD_REOPEN  PERIOD_VIEW  VAT_FILE  WHT_CERTIFY  WHT_REMIT
```

Nothing present rows in the table that the source does not declare, so this is purely an absence.

Constraints: the reconcile's separation of reading from writing is deliberate and stays. Authorization
resolves by permission code, never role name. The startup path must not become a database write.

## Goals / Non-Goals

**Goals:**
- Make a short catalog impossible to hold without knowing, at startup and on the screen where an
  administrator grants permissions.
- Make a refused navigation say what it was refused for, so the four situations that currently look
  identical stop looking identical.
- Keep one source for "what is declared" and "what is missing", so the startup report, the check
  command and the admin screen cannot disagree.

**Non-Goals:**
- Changing `permissions:sync`, `permissions:check`, or the deploy step. They are right.
- Running the reconcile against this database. That is an operational act on restored production
  data and belongs to whoever owns it.
- Deciding which roles should hold the twelve codes. `PERIOD_CLOSE` and `PERIOD_REOPEN` are separate
  codes so that they need not travel together; who holds them is a controls decision.
- Building or repairing the accounting-period feature itself. It is already built; it is unreachable.

**No ledger path is touched.** No `budget_txn`, no `quota_usage`, no `approval_log`. Nothing here
opens an `em.transactional()` or takes a `PESSIMISTIC_WRITE` lock. The startup check and the new read
are both `SELECT`s against `permission`.

## Decisions

### 1. Startup reports, and does nothing else

The application logs the missing codes at startup through the Nest `Logger` the codebase already
uses (`gl-posting.service.ts:338`, `coded-exception.filter.ts:28`), naming each code as
`permissions:check` prints them.

**It does not refuse to boot.** An installation short of twelve codes still serves the sixty-three
that work — every document, budget, approval and payment path in daily use. Refusing to start would
convert a gap that hides three pages into a total outage, and would do it at the worst moment: the
first restart after a restore.

**It does not write the rows.** The archived design separated reconciling from reporting on purpose
so that "what is this environment missing?" could be asked without changing the answer. A write on
every process start would make the catalog change without anyone invoking it, and would do so on
whatever database the process happened to point at.

*Alternative — fail the boot:* it is what `permissions:check` does in a deploy, and correct there:
a deploy that half-applied should not proceed. A running installation is a different subject; the
rows are already missing and stopping the app does not bring them back.

*Alternative — leave it to the deploy step:* that is today, and today a restored database never
meets it.

### 2. The missing set is read, not recomputed

`declaredPermissionCodes()` and `missingPermissionCodes()` are already exported from
`seed-data.ts:179,189` and already shared by `permissions:check`. The startup report and the new
read both call them. Nothing re-derives "which codes are declared" — the way the startup report and
the check command drift is by each knowing separately.

### 3. A separate read for what the catalog lacks

`GET /rbac/permissions` returns `Paginated<CatalogPermission>` (`rbac-admin.controller.ts:43`).
Absent codes belong to the catalog as a whole, not to a page of it, so they go in a sibling read —
`GET /rbac/permissions/missing`, `RBAC_MANAGE`, returning the codes with no row.

*Alternative — add a field to the paginated envelope:* the same list would repeat on every page,
and a standard envelope would grow a field that means nothing per-page.

This also mirrors the shape the codebase already chose one level down: `permissions:check` is a
separate command from `permissions:sync` for the same reason — asking is not the same act as
listing.

### 4. A refusal gets its own address

`evaluateGuard` (`front-end/src/router/index.ts:32`) returns `'home'` on a permission failure. The
guard instead resolves to a `forbidden` route carrying the required code.

A named route rather than a toast over the home page, because the refusal must survive the way it
is usually met: someone pastes a link a colleague sent. A toast is gone on the next navigation and
absent on a reload; an address can be reloaded, screenshotted, and pasted into a message to an
administrator with the code still on it.

There is no not-found route today — the router has no catch-all (`routes.ts` ends at
`approval-config`). The spec requires a refusal to be distinguishable from an address that matches
no route, so this change adds that catch-all too; without it the two collapse again, just at a
different destination.

*Alternative — render the refusal in place at the requested address:* keeps the URL, but leaves an
address that resolves to a page the user cannot have, which then has to be special-cased everywhere
the address is treated as meaningful.

### 5. The admin screen states it where the fix is

The RBAC screen lists the catalog. When the new read returns codes, the screen names them and says
they cannot be granted until the catalog is reconciled. That is the one screen where the person who
can act on it is already standing, and the reason the drift went unnoticed is that the only other
report is a deploy log nobody re-reads.

The screen does not offer a button that runs the reconcile. Reconciling is a deployment act against
a database, invoked deliberately; putting it behind a button in a multi-company admin UI would make
it reachable by anyone holding `RBAC_MANAGE` in any company, for a table that is not company-scoped.

## Risks / Trade-offs

**A startup warning is one more line nobody reads.** → True on its own, which is why it is not on
its own: the same fact appears on the RBAC screen, in front of the person who grants permissions.
The log line is for the operator who restored the database; the screen is for the administrator who
wonders why a page will not open.

**Naming a permission code in a user-facing refusal exposes internal vocabulary.** → It is
vocabulary an administrator needs, and this application already shows permission codes to a user in
the RBAC screen. The refusal names the code because a message that says only "you do not have
permission" sends the reader back to guessing — which is the failure being repaired.

**Adding a catch-all route changes what a mistyped address does today.** → Today it renders nothing
recognisable. A not-found page is what the spec's "distinguishable" scenario requires and is
strictly more informative than the current behaviour.

**The twelve codes stay missing after this change.** → Deliberately. This change makes the gap
impossible to miss; closing it is `pnpm --filter back permissions:sync` against that database plus a
grant decision, and both are the customer's.

## Migration Plan

No schema change and no data migration. The one new endpoint is a read; nothing existing changes
signature.

Deploy order does not matter: the backend read and the frontend screen are independent, and the
frontend degrades to today's behaviour if it ships first (the read 404s and the screen shows no
notice). The startup report is inert on an environment whose catalog is complete — which is every
environment that has taken a deploy.

Rollback is per-decision. Nothing here is coupled to anything else.

## Open Questions

None. The scope is bounded by what the change deliberately does not do — reconcile, grant, or decide
who should hold the twelve codes — and each of those is named in the proposal as the customer's.

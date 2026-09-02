# Implementation notes

## The measured drift (task 1.2)

Taken 2026-08-25 against the `real_server` database — a restore from production — by comparing
`declaredPermissionCodes()` from the source against `select code from permission`.

```
declared 75 · present 63 · missing 12
```

| Absent code | Capability it makes unreachable |
|---|---|
| `PERIOD_VIEW` `PERIOD_MANAGE` `PERIOD_CLOSE` `PERIOD_REOPEN` | closing and reopening an accounting period |
| `GL_JV_POST` `GL_JV_APPROVE` `GL_POST_RETRY` | raising a journal voucher, approving one, retrying a failed posting |
| `BANK_ACCOUNT_VIEW` `BANK_ACCOUNT_MANAGE` | bank accounts and bank reconciliation |
| `VAT_FILE` | filing a VAT return |
| `WHT_CERTIFY` `WHT_REMIT` | issuing a withholding certificate, remitting what was withheld |

No row exists in the table that the source does not declare, so this is purely an absence — the
additive half of the reconcile has nothing to do here.

Three of these surfaced in the UX review as pages that redirect to the home page in silence
(`/new/accounting-periods`, `/new/journal/voucher`, `/new/bank-accounts`) for every user including
`admin`. The remaining nine were found only by running this comparison; nothing in the product
reports them, which is what this change repairs.

**The catalog is deliberately left short.** Closing it is `pnpm --filter back permissions:sync`
against that database plus a decision about which roles hold what — both the customer's, neither
performed here. See task 6.5.

## What implementation ran into

**The route table had no catch-all.** The spec asks a refusal to be distinguishable from an address
that matches no route, and there was no not-found route to distinguish it from — the router simply
resolved nothing. Adding `:pathMatch(.*)*` was therefore part of the requirement, not an extra.

**`evaluateGuard` returned a route name, so nothing could travel with it.** Its signature became
`GuardTarget | null` (`{ name, query? }`) to carry the code. Five specs asserted the old
`toBe('home')` shape and were updated to assert the refusal — `guard.spec.ts`, plus the route-gating
blocks in `JournalVoucherView.spec.ts`, `attendance-self-service.spec.ts` and `attendance-hr.spec.ts`,
which each gained a `refused(code)` helper so the assertions still read as intent rather than shape.

**`rbacAdmin.spec.ts` hand-listed its API mock**, so `loadAll` calling one new read resolved to
`undefined` and threw. Rebuilt from the real module with `importOriginal`, which is what
`web-ui-quality`'s "a module mock covers the surface the component calls" already required and what
stops the next added member repeating it.

**The breadcrumb coverage spec holds every in-app route to a non-empty trail**, so `forbidden` and
`not-found` needed `meta.breadcrumb` and their own labels. Worth keeping: a page with an empty
breadcrumb bar is its own small version of the problem this change is about.

## What was deliberately not done (task 6.5)

The catalog on this installation is **still short of all twelve codes**. Nothing in this change
reconciles it, and nothing grants anything.

Closing it takes two acts, both the customer's:

1. `pnpm --filter back permissions:sync` against that database, which inserts the twelve rows and
   writes nothing else. After it, `permissions:check` exits zero and the startup report goes quiet.
2. A decision about which roles hold which of the twelve, made in the RBAC screen. Nobody holds
   them the moment the rows exist — a row makes a code grantable, not granted. `PERIOD_CLOSE` and
   `PERIOD_REOPEN` are separate codes precisely so they need not go to the same role; closing a
   month is routine bookkeeping, reopening one that has already been reported is not.

Neither was performed here. Running a reconcile against restored production data, and deciding who
may close a period, are not a code change's to take.

## Verified against this installation (tasks 6.3, 6.4)

**Startup, on the real database.** Restarting the backend printed, before serving anything:

```
WARN [PermissionCatalogService] 12 of 75 declared permission code(s) have no row in `permission`,
so they cannot be granted to anyone:
  - BANK_ACCOUNT_MANAGE … WHT_REMIT
Run `pnpm --filter back permissions:sync` against this database.
```

The same twelve the manual comparison found, named, with the next move stated. The app served
every other page normally, which is the point of not refusing to boot.

**The route that used to redirect home in silence.** `/new/accounting-periods` as `admin` now
resolves to `/new/forbidden?code=PERIOD_VIEW` and says so, naming `PERIOD_VIEW` —
[after-16](../../../docs/ux-review/after-16-forbidden-period.png). Before: the home page, with
nothing to distinguish it from a typo.

**The screen where it can be acted on.** The RBAC screen carries the notice above the role table,
naming all twelve codes and why they cannot be granted —
[after-17](../../../docs/ux-review/after-17-rbac-catalog-short.png).

## One thing I broke and put back

Running `npx nest build` overwrote `dist/` under the running `nest start --watch`, which killed the
backend dev server mid-session (the supervising shell survived, its node child did not). I
restarted it. Worth knowing before running a build against a watched dev process again.

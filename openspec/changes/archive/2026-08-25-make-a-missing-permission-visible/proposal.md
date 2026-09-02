## Why

A UX review found that `/new/accounting-periods`, `/new/journal/voucher` and `/new/bank-accounts`
redirect to the home page in silence — for every user, `admin` included. Closing an accounting
period cannot be done by anyone in this installation, and nothing on any screen says so.

The cause is not a missing feature. `PERIOD_CLOSE` and its siblings are declared in TypeScript,
enforced by guards, routed in the SPA, and covered by tests. They simply have no row in the
`permission` table, and a code with no row cannot be granted to anybody.

The catalog machinery for this already exists and works: `permissions:sync` reconciles,
`permissions:check` reports, and `.github/workflows/deploy.yml:142-143` runs both. What it does not
cover is a database that arrives without a deploy. This installation's database is a restore from
production, and a restore bypasses the pipeline entirely. Comparing the source against it:

```
declared 75 · present 63 · missing 12
BANK_ACCOUNT_MANAGE  BANK_ACCOUNT_VIEW  GL_JV_APPROVE  GL_JV_POST  GL_POST_RETRY
PERIOD_CLOSE  PERIOD_MANAGE  PERIOD_REOPEN  PERIOD_VIEW
VAT_FILE  WHT_CERTIFY  WHT_REMIT
```

Nothing in the running product notices. The app boots, serves every other page, and the twelve dead
codes surface only as pages that quietly refuse to open. The review found them by clicking.

## What Changes

**The running application reports a catalog it cannot fully honour.**
- At startup the app compares the declared codes against the `permission` table and logs a
  structured warning naming every code with no row, in the shape `permissions:check` already
  prints. It does **not** refuse to boot: an installation that is short twelve codes still serves
  the sixty-three that work, and turning a partial gap into a total outage would be worse than the
  gap. It does **not** write the rows either — the archived
  `2026-07-26-sync-permission-catalog-on-deploy` separated reconciling from reporting deliberately,
  and a write on every process start would undo that.

**An administrator sees it where they can act on it.**
- The RBAC admin screen lists what the `permission` table holds. When the table is short it SHALL
  say so and name the codes, so that the drift is visible to the person standing in front of the
  grant UI rather than only in a deploy log nobody re-reads. **BREAKING** for `rbac`: the
  authorization read surface gains a statement about codes it cannot offer.

**A route the user may not open says which permission it wanted.**
- `evaluateGuard` (`front-end/src/router/index.ts:32`) returns `'home'` for any permission failure,
  so a blocked navigation is indistinguishable from a mistyped URL, a retired page, and a
  permission nobody can hold. The blocked navigation SHALL name the permission code it required.
  **BREAKING** for `web-shell`: the stated redirect behaviour changes.

**Not changed: the reconcile itself.** `permissions:sync`, `permissions:check`, and the deploy step
are correct as they stand and are left alone. Running the reconcile against this particular
database is an operational act on restored production data, and it is the customer's to take — this
change makes the need for it impossible to miss, not automatic.

## Capabilities

### New Capabilities

None. Both capabilities involved already exist.

### Modified Capabilities

- `rbac`: adds a requirement that the running application detects and reports a short catalog at
  startup, and that the authorization read surface names codes that cannot be granted because they
  have no row. The two existing catalog requirements — the reconcile command and the read-only
  check — are unchanged; this adds the third case they do not cover, an environment that never ran
  either.
- `web-shell`: changes the Permission-Gated Routing requirement so a navigation blocked for want of
  a permission names the code it needed, instead of redirecting to the home page in silence.

## Impact

**Build-order capabilities touched:** `rbac` only, and read-only. No document, budget, quota,
inventory, or notification behaviour changes.

**Invariants:** none in range. Authorization still resolves by permission code, never role name
(invariant 5) — this change makes a code's absence legible, it does not change how a present code
is checked. No `budget_txn` or `approval_log` row is written; no transaction boundary or lock is
involved. The startup check reads the `permission` table and writes nothing.

**Code**
- `back/src/main.ts` (or the module that owns startup) — the catalog report, reusing
  `declaredPermissionCodes()` and `missingPermissionCodes()` from `back/src/seed/seed-data.ts`
  rather than restating the comparison.
- `back/src/modules/rbac/` — the authorization read surface that the admin screen lists from.
- `front-end/src/router/index.ts` — `evaluateGuard` and the `beforeEach` that consumes it.
- `front-end/src/views/admin/` — the RBAC admin screen.
- i18n catalogs for whatever text these add, in `la`, `en` and `zh`.

**Operational** — this installation is short twelve codes today. After this change the gap is
reported at every startup and shown on the RBAC screen; closing it still means running
`pnpm --filter back permissions:sync` against that database, and then granting the new codes to
whichever roles should hold them. Neither is done by this change.

**Not in scope:** which roles should hold `PERIOD_CLOSE` and the other eleven. That is a
segregation-of-duties decision for the customer — `PERIOD_CLOSE` and `PERIOD_REOPEN` are separate
codes precisely so they need not travel together — and it belongs to whoever owns their controls.

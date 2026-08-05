## Context

A production database that has been migrated and seeded still cannot be signed into. The entity
graph says why. `UserCompanyRole` is the row that makes a person a member of a company, and none
of its four foreign keys is nullable — `user`, `company`, `department`, `role`. `AppUser.email`
is required and unique. `RbacAuthService.login` refuses an account whose `emailVerifiedAt` is
null with `EMAIL_NOT_VERIFIED`, and `MembershipService.listForUser` only returns companies
reached through an active `user_company_role`. So the shortest path to a working login is not one
row but six, in two modules, and getting five of them right produces an account that authenticates
and then has nowhere to go.

`seed:prod` writes none of them, on purpose: it is unattended, runs on every deploy, and is
restricted to rows whose codes are written in TypeScript. The demo seeder writes all of them and
is refused when `NODE_ENV` is production or unset, because its accounts share a repository
password. Neither is wrong. The gap between them is what has never existed.

Constraint that shapes everything below: this runs on a machine that already holds the database
credentials. It needs no network surface, and giving it one would be the whole risk of the
feature for none of the benefit.

## Goals / Non-Goals

**Goals:**
- Take a migrated + `seed:prod`-ed database to a state where a named person can sign in and reach
  the RBAC admin screens, in one command.
- Refuse to be a standing mechanism. Once an account exists, the command is an error.
- Take every credential from the operator. Nothing guessable ships in the repository.
- Be all-or-nothing: no half-bootstrapped database.

**Non-Goals:**
- No HTTP endpoint, no CLI prompt flow, no web installer.
- No master data, no fiscal year, no document types, workflows, budgets or quotas. Those are the
  administrator's first job, done through the product, and the reason the bootstrap grants the
  permissions it does.
- Not a recovery tool for a database that has accounts but has lost its administrator. That is a
  different problem with a different answer (a targeted grant), and conflating them is how a
  bootstrap becomes a back door.
- No replacement for the demo seeder. Development keeps `SEED_DEMO=true`.

## Decisions

### Six rows, one transaction, and only one copy of their shape

The command writes `company`, `department`, `role`, `role_permission`, `app_user`,
`user_company_role` inside a single `em.transactional()`.

Five of those six already had a home. `CompanyService.create` builds the same graph — ADMIN role,
the whole active catalog at `COMPANY` scope with group reporting at `GROUP`, an `HQ` department, the
creator's membership — for the same reason, stated in its own comment: without it a new company is
unreachable by the person who made it. Writing that again here would put "what an ADMIN role may
do" in two places, and the day they disagree nothing fails. The first administrator simply sees the
wrong slice of data.

So the shape moved to `provisionCompany(em, input)` in the multi-company module, and both callers
use it: the endpoint, which resolves the currency and opens the transaction, and the bootstrap,
which does the same after creating the account the membership needs. The extraction is behaviour-
preserving and the existing company suites are what say so.

*Alternative considered:* reaching `CompanyService` from the script through a Nest application
context. Rejected on two counts. The service opens its own transaction on its own injected
EntityManager, so the account and the company would commit separately unless a `RequestContext`
were threaded through to force one fork — an invisible mechanism whose removal would silently cost
atomicity. And the specs in this repository construct services by hand; logic that needs a
container to run is logic tested differently from everything around it.

The transaction is not about contention — it is about the run-once guard. The guard asks whether
any `app_user` exists. A run that failed after creating the company but before creating the
account would leave a database that still answers "no accounts", so the next run would bootstrap
again and produce a second company. One transaction makes the guard's question answerable.

*Alternative considered:* separate steps with an idempotent `upsert`, matching the demo seeder.
Rejected — idempotency is the right shape for a seeder that runs on every deploy, and the wrong
shape for a command whose entire contract is that it runs once. An upsert would silently accept a
second invocation with different credentials.

*Ledger note:* this flow writes no `budget_txn` and no `quota_usage` rows, so invariant 2 is not
in play and no pessimistic locking is required. The only concurrency case is two operators running
the command simultaneously; the guard is then a TOCTOU race, and the unique constraints on
`app_user.username`, `app_user.email` and `company.code` are what actually decide it. The loser
fails on a constraint and writes nothing, which is the correct outcome.

### Credentials come from the environment, and their absence is fatal

`BOOTSTRAP_USERNAME`, `BOOTSTRAP_EMAIL`, `BOOTSTRAP_PASSWORD`, `BOOTSTRAP_COMPANY_CODE`,
`BOOTSTRAP_COMPANY_NAME` and `BOOTSTRAP_CURRENCY_CODE` are all required. A missing one aborts
before the database is touched, naming the variable.

There is no default for any of them. This is the same reasoning that keeps the demo seeder off
production: a default administrator password is a published administrator password, and the fact
that an operator *should* change it afterwards has never been what determines whether they do.

The base currency is required for a different reason than the credentials are. `seed:prod` writes
three currencies, so there is nothing to infer, and the wrong one is not an error — it is every
budget in the company denominated in a currency nobody chose, discovered later and by then stamped
onto documents.

The department is not an input at all. It is required only because `user_company_role` demands one,
and `provisionCompany` already names it `HQ` / `Head Office` for the company-admin endpoint; a knob
here would be a second answer to a question already answered.

The password is validated against the same policy the product's own change-password flow enforces,
so the bootstrap cannot mint a password the product would refuse — and is hashed with
`PasswordService`, the same one every other account goes through.

*Alternative considered:* CLI flags. Rejected — flags land in shell history by default; a variable
does not have to.

### The account is created already email-verified

`emailVerifiedAt` is set at creation. Login rejects unverified accounts, verification arrives by
email, and a freshly built server has no mail configured — the deploy's own logs say
`MAIL not configured; skipping email`. An account that cannot be verified is an account that
cannot log in, which is the problem this change exists to solve.

The justification is narrow and does not generalise: the operator setting this variable is the
person holding the database credentials, so the mailbox check that verification performs proves
strictly less than what they have already proven.

### The role gets the whole catalog, at COMPANY scope

Every permission code in the `permission` table is granted to the `ADMIN` role at `COMPANY` scope,
except `REPORT_GROUP_VIEW`, which is granted at `GROUP` — the only scope at which consolidated
group reporting means anything.

Granting less recreates the problem one level down: an administrator who cannot reach the RBAC
screens cannot create the roles that would grant them access. `COMPANY` and not `GROUP` for
everything else keeps invariant 1 intact — the bootstrap creates one company and its administrator
sees one company.

This is deliberately a starting point, not a model of how accounts should look. The first thing the
administrator does through the product is create real roles with real scopes.

### It refuses when any account exists

The guard is `count(app_user) > 0`, not "no admin exists" and not "this username is free".

A database with accounts has a way in, even if the operator has lost it, and the answer to a lost
administrator is a targeted grant against a known account — not a command that mints a new
all-permissions account next to the existing ones. Widening the guard to "no *usable* admin" would
require the command to judge what usable means, on the exact database where being wrong is worst.

### A script over a thin library, mirroring `seed-essentials`

Logic in `src/seed/bootstrap-admin.ts`, a `scripts/bootstrap-admin.ts` wrapper that owns the ORM
lifecycle and the exit code. The split is what lets the guard, the fail-closed validation and the
six-row shape be tested against a real database without a shell.

### It is never wired into the deploy

`deploy.yml` gains nothing. The deploy already refuses the demo seeder for creating loginable
accounts, and this creates one too — with more permissions. A pipeline that can mint an
administrator can mint one on a push nobody read.

## Risks / Trade-offs

- **An all-permissions account exists from minute one** → It is scoped to a single company, its
  credentials were chosen by the operator rather than published, and the permissions it holds are
  exactly the ones needed to replace it with properly scoped roles. It is the seed of
  administration, and the product is where it stops being one.

- **Credentials pass through the environment and may reach shell history or CI logs** → Documented
  to be set from an env file or a `read -s` prompt, never inline on the command line; the README
  procedure ends with signing in and changing the password through the product. The command never
  echoes the password, including on failure.

- **The guard is time-of-check-to-time-of-use** → Two concurrent runs both see zero accounts; the
  unique constraints on username, email and company code decide it, and the loser's transaction
  writes nothing. The outcome is one bootstrap, which is the requirement.

- **Prerequisites can be missing** → An empty `permission` catalog produces a role with no grants,
  and a missing currency a company with no base currency; both are silent failures that look like
  success. The command checks each before writing and aborts naming the prerequisite
  (`pnpm --filter back seed:prod`).

- **The command exists on the production host forever** → It is a repository script and cannot be
  removed by the deploy, so refusal is what protects it. That refusal is a spec requirement with a
  test against a populated database, not a comment.

## Migration Plan

Per environment, once, by hand, after `migration:up` and `seed:prod`, on the host:

1. Export the `BOOTSTRAP_*` variables (from an env file, not the command line).
2. `pnpm --filter back bootstrap:admin`
3. Sign in as the created account; change the password through the product.
4. Create the real roles and companies through the RBAC and org admin screens.

Rollback: delete the six rows the command created — it names them all in its output. The run-once
guard then permits a fresh attempt. No migration is involved and no schema changes.

## Open Questions

None blocking. One judgement worth revisiting after first use: whether `BOOTSTRAP_COMPANY_*`
should instead adopt an existing company when exactly one is present, for the case where a
company was created before anyone tried to log in. Deferred — the failure mode it guards against
has not occurred, and adopting rows the command did not create makes its rollback story worse.

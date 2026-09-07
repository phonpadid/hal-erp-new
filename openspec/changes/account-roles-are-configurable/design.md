## Context

`AccountRoleService.resolve(companyId, role)` reads `account_role` and throws
`UnmappedAccountRoleError` when nothing maps the role or the mapped account is inactive. Twelve call
sites across GL posting depend on it: payment (`CASH_CLEARING`, `VAT_INPUT`, `FX_GAIN`, `FX_LOSS`,
`WHT_PAYABLE`), approval accrual (`ACCOUNTS_PAYABLE`, `CLAIM_PAYABLE`, `GRNI`, `VAT_INPUT`), stock
(`INVENTORY`, `GRNI`, `INVENTORY_ADJUSTMENT`).

The service has `resolve` and nothing else — no create, no controller, no route, no screen. Accounts
by contrast are a full resource: `AccountController` under `COA_VIEW`/`COA_MANAGE`, with a screen at
`/accounts`. So a company can build its whole chart of accounts through the product and still have no
way to say which account is the clearing account.

`golive:check` inspects five kinds of missing decision and none of them is this one. It ran against
the live database, reported five findings, and did not mention that no payment had ever posted.

## Goals / Non-Goals

**Goals:**

- Make a role mapping recordable through the product, by the people who own the chart of accounts.
- Tell a company which roles ITS configuration needs, so the list is short and true.
- Have `golive:check` report the missing ones, since that is the tool people are told to run.

**Non-Goals:**

- Changing `resolve()` or how a posting fails. The failure is correct; it had nowhere to be fixed.
- Creating accounts, or seeding a default chart. Which accounts exist is the accountant's decision.
- Auto-mapping anything, ever. See D3.
- Retrying parked postings — the requeue action already exists and works once the mapping does.

## Decisions

### D1 — The roles list is derived from the enum, not maintained beside it

The screen lists `AccountRoleType`. A second list — a table of "roles we offer to map" — would be a
list to keep in step with the one the GL actually resolves, and the failure mode is silent: a role
added to the resolver and forgotten here is a posting that fails with nothing on any screen to fix
it. That is precisely the state this change exists to end, so it must not be re-created in a smaller
form.

The human-readable purpose of each role travels with it, because `GRNI` names nothing to the person
choosing an account for it.

### D2 — "Required" is derived from the company's own configuration

Sixteen roles exist; a company typically needs four. Reporting all sixteen as missing produces a
checklist people skim, and a skimmed checklist is how this state persisted.

So a role is required when something the company has actually configured will resolve it:

| role | required when |
|---|---|
| `CASH_CLEARING` | any document type settles a payment (`post_action = CUT_BUDGET`, or a type that accrues) |
| `VAT_INPUT` | an active `VAT` tax code exists |
| `WHT_PAYABLE` | an active `WHT` tax code exists |
| `FX_GAIN`, `FX_LOSS` | any document exists in a currency other than the company's base |
| `ACCOUNTS_PAYABLE`, `CLAIM_PAYABLE` | a type has `accrues_on_approval` |
| `GRNI`, `INVENTORY`, `INVENTORY_ADJUSTMENT` | a type moves stock |

The derivation lives in ONE place and both readers use it — the mapping surface and the go-live
inspection — because two derivations of "does this company need an inventory account" would disagree
the first time either was edited.

*Alternative rejected:* a static "core roles" list. Shorter to write and wrong for every company that
does not match the assumption, in the direction that hides work rather than the one that surfaces it.

### D3 — Nothing is ever mapped automatically

It is tempting to point `CASH_CLEARING` at the account called "Cash". A wrong mapping produces a
ledger that BALANCES and is wrong — every entry posts, nothing fails, and the error surfaces at a
reconciliation months later with a year of entries behind it. A missing mapping produces a loud,
parked failure that names itself. The second is strictly better, so the product refuses to guess,
including in the go-live template, which reports the decision rather than proposing an answer.

### D4 — It lives with the chart of accounts: same screen, same permission

A role mapping is a fact about the chart of accounts: which account plays which part. So it goes on
the chart-of-accounts screen, below the accounts themselves, and takes their permissions —
`COA_VIEW` reads and `COA_MANAGE` writes.

Both halves of that follow from the same reasoning and were nearly split: a first cut gave it its own
sidebar entry while claiming in this very section that it belongs with the chart. A second menu item
for a decision made while setting up the chart is a second place to remember, and the person who has
just created an account is the person about to say what it is for — they should not have to navigate
away to do it.

A new permission was rejected for the matching reason: it would be granted to exactly the people who
already hold `COA_MANAGE`, and be one more code to sync into every role that ought to have it.

### D5 — Refuse what could never post

An account may be mapped only if it is of the active company, active, and postable. A header account
resolves fine and then fails at the first entry that touches it, which returns the company to the
state this change exists to fix, one level deeper. Each refusal names its reason so the screen can
say why.

### Budget, quota, and transaction boundaries

None. Mapping a role writes one row in `account_role` and touches no ledger. There is no lock to
take: the mapping is read at posting time, and a posting that races a re-mapping resolves whichever
committed first — both are valid answers, and no arithmetic depends on which.

## Risks / Trade-offs

- **Somebody maps a role to the wrong account** → the mapping is visible on its own screen, in one
  place, next to the account's code and name — which is a large improvement on it being invisible in
  a table nothing displays. Not guessing (D3) is what keeps the wrong mapping a deliberate act
  rather than a default.
- **The requirement derivation drifts from what the GL actually resolves** → mitigated by D1 (the
  list is the enum) and by keeping the derivation in one function both readers call; a role whose
  requirement rule is wrong shows as "not required" while a posting fails, which the undelivered
  screen still reports by name.
- **A re-mapping mid-flight** → entries already posted keep the account they posted to, because a
  journal line stores the account and is never recomputed. The change applies to the next posting,
  which is the only sane reading of it.

## Migration Plan

1. Ship the service and controller; nothing changes for a company that never calls them.
2. Ship the screen and the go-live finding. The live company's missing roles appear immediately in
   both, naming exactly what its own configuration needs.
3. The company's accountant creates the accounts they want (existing screen) and maps the roles (new
   screen).
4. The parked postings are requeued from the existing undelivered-postings screen, and the ledger
   fills in behind them.
5. Rollback removes the surface; mappings already recorded stay valid, because the resolver reads
   the same table it always read.

## Open Questions

- Should `golive:apply` be able to record mappings from its config file, as it records other
  decisions? Consistent, and deliberately left out here: applying a mapping needs accounts that exist
  in the target database, which the template cannot know. Worth revisiting once the screen has been
  used on a real setup.

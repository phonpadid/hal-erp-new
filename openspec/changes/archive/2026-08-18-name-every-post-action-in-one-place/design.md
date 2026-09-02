# Design — Name every post-action in one place

## Context

`document_type.post_action` is a free-form `varchar` read by thirteen call sites across six modules
and dispatched by one switch. The set of values it may hold is written in five places that disagree,
and the two ways a stored value can mean "do nothing" — `null` and the literal `'NONE'` — are the
same two code paths a misspelling takes. This change gives the set one declaration, one spelling for
absence, and a refusal at every layer that can hold the value.

Nothing has launched, so no compatibility path is owed to stored data beyond a dev-database
normalisation.

## Decisions

### D1. The set is declared in `@erp/shared`, not in a backend enum

The value is written by a Vue Select, validated by a Zod resolver, validated again by a
class-validator DTO, stored by MikroORM, and dispatched by a NestJS switch. Only `@erp/shared` is
reachable from both ends. CLAUDE.md already directs form schemas there — *"prefer a shared schema
package as the single source of truth"* — and the package already carries `FIELD_TYPES`,
`CONDITION_OPS` and `RESET_CYCLES` for the same reason, plus `isFieldVisible`, whose docblock states
the principle this change applies: one evaluator used by both sides "so display and enforcement
cannot drift".

`back/src/common/enums/index.ts` is the wrong home despite holding every other enum: the frontend
cannot import it, so putting the set there guarantees a second copy in `shared` and reproduces the
problem in a new pair of files.

### D2. `null` is the only stored spelling of "no post-action"; `'NONE'` never leaves the form

Three candidates:

| | stored absence | cost |
| --- | --- | --- |
| **null only** (chosen) | `null` | the form must map its sentinel at submit |
| `'NONE'` only | `'NONE'` | not-null migration; every `if (!action)` becomes a comparison |
| both | either | today — indistinguishable from a typo |

`null` wins on evidence already in the tree: the column is nullable, the seed writes absence rather
than a sentinel, and `run()` opens with `if (!action) return` — one guard at the top rather than a
case in the switch.

**Revised during implementation: the sentinel is removed, not mapped.** The first attempt kept
`'NONE'` as a Select value and translated it in `onSubmit`. That cannot work, and the suite said so
immediately: the form validates against the same `documentTypeSchema` the server's DTO mirrors, so a
sentinel in form state must either be a member of the schema — putting a value in it that the column
refuses, which is the drift this change exists to end — or fail validation, which is what happened
(the form could no longer submit at all). The no-action option carries `null` instead. A PrimeVue
Select holds it and falls back to its placeholder for the label, which costs a rendered chip and
removes a concept.

### D3. A CHECK constraint, not a Postgres enum type

`Migration20260826000000` narrowed the approval action with a check rather than a type, and this
follows it. A Postgres enum needs `ALTER TYPE … ADD VALUE` for each future action, which historically
could not run inside a transaction and makes the reverse direction awkward; a CHECK is dropped and
recreated in an ordinary migration. The constraint also has to admit `null`, which reads naturally as
`post_action is null or post_action in (…)`.

Ordering inside the migration matters: normalise `'NONE'` to `null` **first**, then add the
constraint. Adding it first fails on the rows the change exists to clean up.

The constraint is the layer that survives what the validators cannot reach — a seed, a migration's
`down()`, a manual `update`. `Migration20260719000000` is the precedent: it renamed `CREATE_PO` to
`CREATE_SUCCESSOR` with a bare `update` and left a `down()` that restores a value nothing dispatches.
With the check in place that `down()` would fail loudly instead of quietly reinstating a no-op.

### D4. The entity property must be typed as the union, or exhaustiveness cannot work

This is the crux rather than a detail. `assertNever` narrows a union to `never`; a switch over
`string` never reaches `never`, so the call does not compile no matter where it is placed. The chain
that has to be typed is:

```
shared: POST_ACTIONS  →  type PostAction
        ↓
document.entities.ts   postAction?: PostAction     ← without this, everything below is still string
        ↓
post-action.service    const action = docType.postAction
                       if (!action) return              → PostAction
                       switch (action) { … }
                       assertNever(action)              → compiles only now
```

Typing the entity property is safe because the CHECK constraint (D3) is what makes the database's
contents match the type. Validators alone would not justify it; a constraint does.

### D5. `assertNever` stays inside `retry`, and three attempts at a programming error is acceptable

`run()` wraps the whole switch in `retry(…, 3)`, which catches indiscriminately. An `assertNever`
throw is deterministic, so it will be attempted three times before propagating. The alternative —
hoisting dispatch out of `retry` so the branch is chosen once and only the work is retried — changes
the retry semantics of all twelve actions to fix log noise on a branch that should be unreachable.
Accepted as is: the outcome is correct (the transaction rolls back and the approval fails loudly),
and the cost is two extra log lines in a case that means a developer added a value without a branch.

### D6. The subsets become views of the one set

`RESERVING_ACTIONS` is currently a `const` inside a method body at `document-submit.service.ts:370`;
`MOVEMENT_POST_ACTIONS` is a module export in `movement-doctype.resolver.ts`. Both move to `shared`
beside `POST_ACTIONS`, typed `readonly PostAction[]`, so renaming a member breaks the subsets at
compile time. The two `POST_JOURNAL` declarations (`post-action.service.ts:33`,
`journal-voucher.service.ts:24`) collapse into a single import, and the bare literals in
`matching.service.ts`, `owed.ts`, `document-submit.service.ts`, `budget.service.ts` and
`budget-adjustment.service.ts` are replaced by references to it.

### D7. A second active `POST_JOURNAL` type is refused where it is configured

Opening the full set to the admin screen makes a failure reachable that the seed prevented by
construction: `journal-voucher.service.ts:262` refuses to resolve a voucher type when a company has
two active ones. Without a guard, offering `POST_JOURNAL` in the Select moves that failure from
configuration time to the next time somebody tries to write a voucher — a worse place for it, and
one where the person who caused it is not present.

The guard belongs in `document-type.service.ts` on create and update, company-scoped, and applies to
`POST_JOURNAL` alone. The movement actions need none: `resolveMovementDocType` already answers
0 / 1 / many and asks the caller to choose, which is a deliberate feature.

### D8. `budget_movement.movement_type` is constrained by consequence, not by its own change

`budget-adjustment.service.ts:95` writes `movementType: docType.postAction!`, so closing the source
closes most of what can reach the destination. Giving that column its own enum is a separate change:
its DBML note is stale for an independent reason (`budget-plan.service.ts:189` writes
`ACTIVATE_BUDGET`, which the note does not list), and settling that is a question about what a budget
movement is, not about what a post-action is.

## Risks

- **A dev database holding a value outside the twelve** fails the migration. That is the intended
  behaviour — the alternative is a silent normalisation of data nobody looked at — and the failure
  names the offending rows.
- **Typing the entity property** turns any remaining `string` assignment into a compile error, which
  may surface call sites this design did not enumerate. Those are the point of the change; they are
  found at build time rather than at approval time.
- **The admin screen gaining five options** lets a company configure a stock or voucher type that the
  seed used to be the only source of. Every one of them already has spec coverage and an
  implementation; the exposure is that a type can now be created without the seed's accompanying form
  template, which is true of every other post-action already offered.

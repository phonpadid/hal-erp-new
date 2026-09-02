# Name every post-action in one place

## Why

Invariant 7 says document behaviour comes from configuration, not code, and `document_type.post_action`
is where the heaviest of that configuration lives: it decides whether full approval cuts a budget,
moves stock, posts a journal, activates an appropriation, or ends someone's employment. It is a
`varchar` with no enum, no CHECK, and no validator. The set of values it may hold is written down in
five places, and no two of them agree.

```
 erp_approval_system.dbml:666      shared POST_ACTIONS       shared documentTypeSchema
 (CLAUDE.md: reference this        (what the admin UI        (CLAUDE.md: the single
  exactly)                          offers)                   source of truth)
 ────────────────────────────     ────────────────────      ─────────────────────────
  CUT_BUDGET                       NONE                      z.string().optional()
  CREATE_SUCCESSOR                 CUT_BUDGET                        ↑
  TRANSFER                         CREATE_SUCCESSOR           no constraint at all,
  ADJUST_INCREASE                  TRANSFER                   three lines below the
  ADJUST_DECREASE                  ADJUST_INCREASE            list it could have used
  UPDATE_EMPLOYEE                  ADJUST_DECREASE
  TERMINATE_EMPLOYEE               UPDATE_EMPLOYEE           config.dto.ts:138 / :183
                                   TERMINATE_EMPLOYEE        ─────────────────────────
                                                              @IsString() @MaxLength(255)

 post-action.service.ts:72 — the switch that actually runs
 ─────────────────────────────────────────────────────────
  CUT_BUDGET · CREATE_SUCCESSOR · TRANSFER · ADJUST_INCREASE · ADJUST_DECREASE
  UPDATE_EMPLOYEE · TERMINATE_EMPLOYEE · ACTIVATE_BUDGET · POST_JOURNAL
  ISSUE_STOCK · ADJUST_STOCK · TRANSFER_STOCK                        ← twelve
```

The comment above `POST_ACTIONS` states the rule the file then breaks: *"Keep this list in lockstep
with that switch — anything not handled there is a silent no-op."* It is five values out of lockstep.

**Two spellings of "do nothing", and a typo is a third.** The admin form initialises `postAction`
to the literal `'NONE'` and submits `e.values` unchanged, so a type created through the UI stores the
string `'NONE'`; a type created by the seed stores `null`. In the engine, `null` returns at
`if (!action) return`, `'NONE'` falls to `default: return`, and so does `CUT_BUDET`. Three different
configurations — deliberate, deliberate, and mistaken — take two code paths that behave identically
and say nothing. A document type whose post-action is misspelled accepts documents, routes them
through every approval step, writes the full `approval_log` trail, reaches `COMPLETED` — and cuts no
budget. Nothing surfaces until a balance is questioned.

This is the shape `honour-every-field-the-api-accepts` and `say-who-withdrew-the-document` already
removed from the approval endpoint, where a narrowed DTO and an exhaustive `assertNever` replaced a
switch that could log an action and then ignore it. The helper written for it,
`back/src/common/validation/assert-never.ts`, is in the tree. The post-action switch never got it.

**The engine's own list is a local const inside a function body.** `RESERVING_ACTIONS` is declared
at `document-submit.service.ts:370`, inside the method that uses it. `MOVEMENT_POST_ACTIONS` is a
module export in `movement-doctype.resolver.ts`. `POST_JOURNAL` is declared **twice** — once in
`post-action.service.ts:33` and once as `POST_JOURNAL_ACTION` in `journal-voucher.service.ts:24` —
two constants for one literal in two modules. Everywhere else the value is compared as a bare string:
`matching.service.ts:51`, `owed.ts:65`, `document-submit.service.ts:152` and `:165`,
`budget.service.ts:144-146`. Thirteen readers across six modules, and no declaration any of them
share.

**A misspelling reaches a record that is meant to be evidence.**
`budget-adjustment.service.ts:95` writes `movementType: docType.postAction!` — the unvalidated
configuration string is copied straight into `budget_movement.movement_type`. That column is itself
a free-form varchar whose DBML note lists three values while the code writes at least four
(`ACTIVATE_BUDGET` joins them from `budget-plan.service.ts:189`). The looseness does not stay in the
configuration table; it lands in the record of why a budget moved.

**Five capabilities cannot be configured by the people who own them.** `POST_JOURNAL`,
`ISSUE_STOCK`, `ADJUST_STOCK`, `TRANSFER_STOCK` and `ACTIVATE_BUDGET` all have full specs and working
implementations, and none of them appears in the list the admin screen offers. A company that wants a
second stock-issue type, or a journal-voucher type of its own, cannot create one — those types exist
only because `seed-data.ts` wrote them. The screen compensates for this rather than fixing it:
`DocTypeFormView.vue:68` appends the stored value as an extra option so the Select is not blank when
editing one of them, under a comment admitting the engine's values "are a superset of the
POST_ACTIONS form enum". That fallback is load-bearing today, and it is a symptom.

**The set has already been renamed once, by hand.** `Migration20260719000000` renamed `CREATE_PO` to
`CREATE_SUCCESSOR` with `update "document_type" set "post_action" = ...`, its docblock noting that
`post_action` is "a free-form varchar (no enum/CHECK), so only data changes here". Its `down()`
restores `CREATE_PO` — a value nothing has handled since. The set is not stable, it has no guard, and
the last person to change it left the reverse path pointing at a silent no-op.

## What Changes

**One declaration, in `@erp/shared`.** `POST_ACTIONS` becomes the complete set of twelve the engine
dispatches, with an exported `PostAction` type. Both validators use it — `z.enum(POST_ACTIONS)` in
`documentTypeSchema`, `@IsIn(POST_ACTIONS)` in the create and update DTOs — so the API refuses an
unknown action at the boundary instead of storing it. The backend switch imports the same constant,
and the two `POST_JOURNAL` declarations collapse into it, as do `RESERVING_ACTIONS` and
`MOVEMENT_POST_ACTIONS`, which become named subsets of the one set rather than independent lists.

| action | what full approval does |
| --- | --- |
| `CUT_BUDGET` | convert the reservation to actual; the document becomes payable |
| `TRANSFER` | move appropriation between budgets |
| `ADJUST_INCREASE` / `ADJUST_DECREASE` | raise or lower an appropriation |
| `ACTIVATE_BUDGET` | turn an approved plan into `ACTIVE` budgets |
| `CREATE_SUCCESSOR` | record the obligation to create the successor documents |
| `ISSUE_STOCK` / `ADJUST_STOCK` / `TRANSFER_STOCK` | write the stock movement |
| `POST_JOURNAL` | post the voucher's lines to the ledger |
| `UPDATE_EMPLOYEE` / `TERMINATE_EMPLOYEE` | apply the promotion or the resignation |

**"No post-action" gets one spelling.** `null` means the type does nothing on approval. `'NONE'`
stays a display sentinel inside the form and SHALL be mapped to `null` before the request is sent, so
it never reaches the column. A migration normalises existing `'NONE'` rows to `null` and adds a CHECK
constraint admitting only the twelve — the same move `Migration20260826000000` made for the approval
action check, and the reason the value cannot drift again by data edit or by a future migration's
`down()`.

**The switch ends in `assertNever`.** Adding a value to the set without a branch becomes a build
error rather than a document that approves and does nothing. The `default:` arm goes; with the column
constrained and `null` handled at the top, there is nothing left for it to catch.

**The admin screen offers all twelve.** The five actions that exist only in the seed become
configurable, which makes `DocTypeFormView.vue:68`'s fallback dead code and removes it. One guard
comes with that: `POST_JOURNAL` is resolved by uniqueness — `journal-voucher.service.ts:262` refuses
to work when a company has two active types carrying it — so the create and update paths SHALL refuse
a second active `POST_JOURNAL` type for a company, with the error at configuration time rather than
the next time somebody writes a voucher. The movement actions need no such guard; they already
resolve 0 / 1 / many and ask the caller to choose.

**The DBML note is corrected** to list the twelve, because CLAUDE.md directs everyone to reference it
exactly and it has been five values short.

## Who this answers

| party | what they could not do | after |
| --- | --- | --- |
| whoever configures document types | create a stock-issue, voucher, or budget-plan type | every action the engine runs is on the list |
| whoever configures document types | find out that a post-action was misspelled | the API refuses the value at the boundary |
| an approver | trust that full approval did what the type promised | an unhandled action cannot reach approval |
| an auditor | tell a deliberate no-op from a broken one | `null` is the only way to mean "nothing" |
| whoever reads `budget_movement` | rely on `movement_type` being one of a known set | it can only carry a value the set allows |
| the next person to rename an action | know where the set is written | it is written once |

## What This Change Does NOT Do

- **Does not add or remove a post-action.** The set is exactly the twelve the switch already
  dispatches. Deciding whether the engine should gain a thirteenth is a different question, and this
  change is the thing that would make asking it cheap.
- **Does not change what any action does.** No dispatch behaviour is touched; only which values may
  reach the dispatcher, and from how many declarations.
- **Does not close `budget_movement.movement_type`.** Constraining `post_action` constrains what can
  be copied into it, which is most of the exposure; giving that column its own enum is a separate
  change with its own migration, and its DBML note is stale for a second reason (`ACTIVATE_BUDGET`)
  that this change does not resolve.
- **Does not unify how a document type is resolved by its post-action.** `POST_JOURNAL` errors on two
  candidates while the movement actions ask the caller to choose. Two policies for one question is
  worth settling, but settling it is not what closing the set requires.
- **Does not touch the other configuration flags.** `requires_budget`, `requires_quota`,
  `requires_payee`, `accrues_on_approval` are booleans; they cannot hold an unknown value.

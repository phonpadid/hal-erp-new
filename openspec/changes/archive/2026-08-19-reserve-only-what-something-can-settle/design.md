# Design — Reserve only what something can settle

## Context

A document type that reserves budget needs something to convert that reservation into spend. Three
shapes in the reference configuration do it; a fourth — `CLAIM` — reserves and has neither a
settling post-action nor an outgoing reference pairing, so its reservation is unresolvable by
construction.

```
PR    requires_budget  post_action=CUT_BUDGET      settles itself at approval        ✓
PROC  requires_budget  post_action=CREATE_SUCCESSOR  PROC → PO → DISB settles it     ✓
DISB  —                post_action=CUT_BUDGET      is the settler, for an ancestor   ✓
CLAIM requires_budget  post_action=(none)          nothing, ever                     ✗
```

Two things follow: `CLAIM` is misconfigured, and nothing in the system notices a configuration of
that shape. This change fixes the first and closes the second.

## Decisions

### D1. `CLAIM` settles itself rather than gaining a chain

Two configurations would give the reservation a way out. Only one of them is honest about what a
compensation claim is.

| | what it would mean |
| --- | --- |
| pair `CLAIM → DISB` | a claim becomes a purchase settled by a disbursement. `DISB` is `requires_vendor`, and a compensation is owed to an employee — there is no vendor to name. The accrual would then follow the chain instead of reading the claim's own rows, and `gl-posting.service.ts` says the opposite deliberately: *"A compensation keeps reading its OWN rows… it has no chain, and its accrual belongs to the document that was approved."* |
| **`post_action = CUT_BUDGET` (chosen)** | the claim converts its own reservation at approval — the shape `PR` already runs, and the one `cutBudget` calls *"a single self-reserving CUT_BUDGET document"* and handles explicitly |

The second is also the only one consistent with the flag already on the type. `accrues_on_approval`
says the obligation is recognised at approval; for a self-reserving type the budget ledger's way of
saying the same thing is an `ACTUAL` on the same event. A type that says it in one ledger and not
the other has not been given two facts — it has been given one fact and one omission.

### D1a. Reachability alone is not enough for a type that accrues

Writing the specs surfaced a case the reachability rule does not cover. `cutBudget` settles the
**reserving** document — `resolveReservingDocument` walks the chain back to whoever took the hold —
so a successor settling on a predecessor's behalf writes the `ACTUAL` rows under the *predecessor's*
id. A hypothetical `CLAIM` paired to some settler would therefore end up with `ACTUAL` rows of its
own and would pass a reachability check.

It would still be broken, because of **when**. The accrual runs at the claim's own approval, and the
successor does not exist yet. It would find no rows, log `Accrual skipped`, and record a terminal
`SKIPPED` — the same failure, reached by a longer route.

So a second rule is needed, narrower and about timing rather than existence:

> A type that both reserves its own budget and recognises its expense at approval SHALL settle that
> reservation through its **own** post-action.

This is stated in one direction only, deliberately. The converse is false: `PR` settles without
accruing and is perfectly coherent — not accruing, it books nothing until payment. Turning the
relationship into a two-way law would reject a configuration that works.

### D2. The rule asks whether a reservation *can* be settled, never whether it *has been*

`PROC` reserves at submit and is still holding that reservation when it reaches `COMPLETED`, on
purpose: the `DISB` at the end of its chain is what settles it, and that may be days later. A rule
phrased as *"a completed document leaves no outstanding reservation"* would be simpler to implement
and would reject the one chain the engine is built around.

So the question is asked of the **configuration**, once, at the moment it is written — *is there any
path by which this reservation could ever be settled?* — and never of an individual document. A
document sitting on an unsettled reservation is either in flight or evidence of a configuration this
change refuses; the difference is decided before any document exists.

### D3. A settler is named by its post-action, in one place

Only `CUT_BUDGET` converts a budget reservation: `post-action.service.ts` dispatches it to
`cutBudget`, which is the sole caller of `BudgetLedgerService.settle`, which is the sole writer of
`ACTUAL`. That chain is currently a fact you can only learn by reading three files.

It becomes a named export beside the other post-action groupings in `shared`, the way
`MOVEMENT_POST_ACTIONS` and `RESERVING_ACTIONS` already are. `RESERVING_ACTIONS` is deliberately not
reused: it means *reserves stock* (`ISSUE_STOCK`, `TRANSFER_STOCK`) and has nothing to do with
budget. Two different resources with two different lifecycles should not share one list because the
word "reserve" appears in both.

### D4. The walk uses every configured pairing, not only the auto-created ones

`document_type_ref` carries `auto_create`. `CREATE_SUCCESSOR` acts on the `true` ones; the `false`
ones are for manual create-from, which is how a `DISB` is actually raised against a `PO`. Both are
real routes to a settler, so reachability considers every pairing and ignores the flag.

Walking it is cheap and exact rather than heuristic: `document_type_ref` is configuration, it is
company-scoped, and it is already the authority the server enforces on `POST /documents/from/:refId`
— a successor that is not paired is refused there. The set of documents that could ever settle a
reservation is therefore exactly the set this graph allows. The reference configuration has three
edges.

The walk must be cycle-safe. Nothing forbids `A → B → A` in the table, and a naive recursion would
not return.

### D5. A path runs through active types only, and the rule binds active types only

Both routes to a successor already respect `is_active`: `autoCreateSuccessorsFor` filters
`successorType.isActive` and logs a no-op when none is active. A path through a type nobody can
raise is not a path, so the walk skips inactive nodes.

The rule itself binds only while the reserving type is active, which is how the neighbouring rule in
the same file already behaves — `assertNoOtherVoucherType` is applied `if (docType.postAction ===
POST_JOURNAL && docType.isActive)`. Deactivating a dead-end type is allowed: it raises no documents,
so it reserves nothing. Reactivating it runs the check again, because the check reads **the
resulting state rather than the dto** — the discipline that file states in a comment and that makes
a rule catch both directions instead of only the obvious one.

### D6. Reachability cannot be checked when the type is created — the graph does not exist yet

The obvious place to check is `DocumentTypeService.create`, and it is the wrong one. A pairing
references two document types, so a type that has just been created has no edges and cannot have
any. Enforcing reachability there would make the `PROC` shape — reserves, settled by a disbursement
further down its chain — impossible to build: refused at creation, and never reachable afterwards
because the pairing that would satisfy the rule needs the type the rule just rejected.

The moment that actually matters is later. A document type cannot have a document raised against it
until it is mapped to a department: `dept_doc_type` is what `listCreatableTypes` reads and what
`createDraft` resolves through. An unmapped type reserves nothing because nobody can raise it, and
by the time somebody maps it the pairings can exist. **Mapping a type to a department is where a
reservation first becomes possible, so it is where the rule binds.**

So four writes, not three:

```
1. mapping a type to a department   DeptDocTypeService.create   the type becomes raisable
2. updating the reserving type      DocumentTypeService.update  its post_action, or its active state
3. removing a pairing               removePairing               deletes an edge on somebody's only path
4. deactivating a type              update                      removes a node on somebody's only path
```

`DocumentTypeService.create` still enforces the accrual-timing rule of D1a, because that one reads
the type's own flags and needs no graph at all.

(3) and (4) are the same question asked from the other side — *would this write strand a reservation
that is fine today?* — and the codebase already answers exactly that question for a different
resource: `budgetsStrandedByDeactivating` refuses to deactivate a control point that would strand a
budget. This follows it.

The cost is bounded and small: on (3) and (4), re-walk the company's active `requires_budget` types.
The reference configuration has nineteen types and three edges, and a company with a thousand of
either has a different problem.

### D6a. Validation runs before the entity is built

`DocumentTypeService.create` currently calls `em.create()` and then validates. MikroORM persists on
create, so a rejected create leaves the entity in the shared EntityManager's unit of work, where the
next flush picks it up — a type that was refused can appear to exist. It went unnoticed while every
rejection was a duplicate-code check that ran before `em.create`; adding a rule that runs after it
is what surfaced it. The checks move ahead of the entity.

### D7. The rule is enforced on write, and does not retro-validate what is already stored

A database configured before this change may hold a dead-end type, and nothing in this change goes
looking. The reference seed is corrected, and every subsequent write is checked; a configuration
that is never touched again is never re-examined.

That is a deliberate limit rather than an oversight. A startup scan would have to decide what to do
about what it finds — refuse to boot, log and continue, or quarantine the type — and each answer is
worse than the last for a system that is otherwise running. The proposal already declines to build
a report for stranded reservations on the same reasoning: once the configuration cannot produce
one, `committed` means what it says again.

## Risks

- **The rule is only as good as the pairing graph's honesty.** It proves a *route* exists, not that
  anyone will walk it. `PROC` is reachable to a settler and its reservation still sits outstanding
  until somebody raises the disbursement. This change does not promise that reservations resolve —
  it promises none of them are impossible, which is a strictly weaker and actually checkable claim.
- **Correcting `CLAIM` does not correct the claims already approved under the old configuration.**
  `budget_txn` is append-only (invariant 2) and the post-action has already run. On the test
  database that is one document, left in place as known-bad demo data and recorded in the proposal.
  On a real one it would be a migration question, and a corrective release is not the same
  accounting statement as a budget increase — that decision belongs to whoever owns the books.
- **The two rules overlap, and the narrower one does the real work for accruing types.** Every
  configuration D1a refuses is also refused by D2's reachability check when it has no path at all,
  but not the reverse: a dead end with a *path* passes reachability and still fails the accrual on
  timing. Keeping both means two error messages for one underlying mistake, and they must say
  different things or the second will read as the first repeating itself.
- **Deactivating a type now has a new way to fail.** An administrator retiring a document type may
  be told they cannot, because something else's only settlement path runs through it. That message
  has to name the dependent type, or it reads as the system being obstinate — the same reason the
  disabled cards in `offer-only-the-doors-you-can-open` name the permission they need.

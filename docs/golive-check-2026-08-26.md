# `golive:check` baseline — 2026-08-26

The first run of `pnpm --filter back golive:check`. Its output is the question list to put to the
customer; nothing here is a defect.

## Where this was run

Against **`demo_erp`** — the local working copy — not `real_server`. That matters for reading the
numbers below, because this copy carries the `E2E-SBX` sandbox an earlier end-to-end run left
behind, and that sandbox **maps all eleven `REC*` types to its own department**.

So on this database the eleven types look mapped and the check reports their *forms* instead. On
`real_server`, which has no such department, the same eleven appear as `UNMAPPED_TYPE` — the
finding that actually blocks go-live. **Re-run this against `real_server` before taking anything to
the customer.** The command is read-only (asserted by `scripts/golive/inspect.spec.ts`, which
compares row counts for every table it reads), so running it there changes nothing.

## What it reported

```
HAL: 14 finding(s)
  UNPUBLISHED_TEMPLATE       11
  PERSON_TARGETED_WORKFLOW    2
  UNRESOLVABLE_CURRENCY       1
  UNMAPPED_TYPE               0   ← an artifact of E2E-SBX; expect 11 on real_server
  MISSING_AUTHORING_ROUTE     0   ← fixed earlier today; boot:check now fails a deploy on it
```

### The eleven draft forms

Every `REC*` type is mapped to a form template still `DRAFT`, most at v1 and `RECHPY` at v2. A
mapping to a draft form is not raisable, so this is the same wall as an unmapped type one step
further along.

### Two person-targeted chains

```
"E2E — two-step approval"                    e2e.approver1, e2e.approver2
"ໃບເບີກຈ່າຍຄ່າບໍລິການເທັກໂນໂລຊີ"              xone, LATTANAPHONE
```

Neither chain reaches a role, so nobody can approve when those four cannot, and there is no
delegation to fall back on. The first is the sandbox's own and will go with it. **The second is the
customer's real chain**, and whether it should target roles instead is question 6.2.

The roles that exist are `ພະນັກງານ` (84 holders — too broad to approve anything), `Administrator`
(4), and two single-holder finance roles. A role-targeted chain probably needs roles that do not
exist yet. The check reports the problem; creating those roles is the customer's decision.

### One currency with no rate

Documents exist in USD and no `USD→LAK` rate resolves on any of the resolver's four paths, so a new
USD document is refused at submit — the rate is stamped there (invariant 6) and there is nothing to
stamp. The seven existing USD documents are unaffected; theirs is already locked.

## The three questions this leaves

Unchanged from the proposal, and none of them answerable from the code:

1. **Which department raises each `REC*` type, and under which workflow?**
2. **Should the approval chains target roles — and which roles, given that a suitable one may not
   exist yet?**
3. **Do USD documents continue?** If yes, a rate source and a `BUDGET_RATE` policy are needed. If
   no, deactivating the currency makes the finding go away honestly.

## The file to fill in

`golive:check --template <path>` writes a JSONC file pre-populated with every subject found and a
blank slot for each decision, with the question written in beside the slot. Every slot is `""` or
`null` on purpose: a plausible default would be applied without being read, and a wrong route is
not visibly wrong afterwards, because every downstream rule is *about* the route.

---

## The round trip, exercised

`golive:apply` was run against `demo_erp` with a file that publishes the eleven sandbox forms and
states nothing else. It invents no routing: which department raises each `REC*` type is question 1,
and a plausible-looking guess applied without being read is the thing this whole design refuses.

```
golive:apply --dry-run   →  WOULD CHANGE (11), LEFT ALONE (13), rolled back, nothing written
golive:apply             →  CHANGED (11)
golive:apply  (again)    →  nothing
golive:check             →  14 findings → 3
```

The three that remain are the two person-targeted chains and the USD rate — questions 2 and 3, both
the customer's.

### Two defects the round trip found that the unit specs did not

**Idempotence broke in a fresh process.** The resolver read existing mappings without populating
`formTemplate`, so `apply` read its `status` as `undefined`, decided a publish was needed, and the
service refused a template that was already `PUBLISHED`. The unit spec passed throughout, because
the identity map had hydrated that reference from an earlier read in the same process. The spec now
calls `em.clear()` before each run, which is what a CLI invocation actually looks like.

**A type error `nest build` cannot see.** `tsconfig.build.json` excludes `scripts/`, so nothing
typechecks these files until `ts-node` compiles them at run time — which is to say, in front of
whoever is running the command. A `FilterQuery` mistake in `applyRates` surfaced that way. Worth a
`typecheck:scripts` gate; not in this change.

## What is still blocked

Task 5.2's second half — applying a *complete* file to a scratch copy and running the whole `e2e`
suite against the customer's own configuration rather than a sandbox the suite builds for itself.
That is the check that go-live configuration actually works, and it cannot be written until
question 1 has an answer.

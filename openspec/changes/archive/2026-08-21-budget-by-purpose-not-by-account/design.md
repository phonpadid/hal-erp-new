## Context

`budget` is keyed `(fiscal_year_id, department_id, gl_account)`, and that key encodes an assumption:
that a budget line and a GL account are the same thing seen twice. Everything downstream leans on
it — a document line resolves its budget by walking `item → item_company.default_gl_account →
budget`, and `budget_control_point` decides which budgets it governs by walking the **account** tree
upward from `budget.account_id`.

The customer's books contradict the assumption in both directions simultaneously. One voucher posts
thirteen lines to account `658.0007` spanning three budget lines in one department; one budget line
(`1.3 vehicle instalments`) posts to a liability account and an expense account. `Account A → Budget
X`, `Account B → Budget X`, `Account A → Budget Y` cannot all be true while the account sits inside
the budget's identity.

Two facts shape the whole design:

**They already tag every transaction.** 5,714 of 5,738 spend rows in their monitoring sheet carry a
hand-written budget code. The budget is not something they derive from the account — it is something
a person decides and writes down. Their accounting system has no budget column and their budget
sheet has no account column; the link lives in a person's head.

**The control point already does the hard part.** `budget_control_point` is placed at any node, a
budget must pass every point that covers it, tolerance ladders decide WARN vs BLOCK, and the point
row is the only row locked to serialize budget work. None of that depends on which tree is walked.

## Goals / Non-Goals

**Goals:**

- Give a budget an identity that does not contain an account, so many-to-many is expressible.
- Make the account and the budget two independent dimensions of a document line.
- Move control-point coverage to the node tree without disturbing what a control point *is*, how
  it is checked, or how it is locked.
- Keep the change small enough that invariants 2–5 are provably untouched.

**Non-Goals:**

- Monthly or quarterly phasing. That is *which period's money*; this is *which node's money*. They
  compose; tangling them does not.
- An account↔budget mapping table, in any form, including advisory. See the decision below.
- Revenue budgeting.
- Changing the balance formula, the ledger's append-only rule, or reserve → actual → release.

## Decisions

**A budget's identity is the node it sits at.** The account leaves the identity entirely; a
`budget_node` takes its place. The alternatives for naming a budget were its own name and no natural
key at all. The name is a bad key — a typo fix rewrites the identity, and two Lao names differing by
one space become two budgets. No natural key means nothing stops "fuel" existing twice in one
department with the spend silently split. A node's `code` costs one column and one index, and it is
the vocabulary the organisation already speaks: department heads say "4.202", the plan is written in
it, and half a year of 2026 actuals are reconcilable against it.

**The tree is its own table, `budget_node`, and a node is NOT a budget.** Their plan is already a
tree — department `1` → category `1.1` → line `1.101` — and the tree is what control points walk.
The first attempt put `parent_id` on `budget` and made categories budget rows with no amount. That
is the decision this design reversed, and the reason is in the consumer trace below: it left five
places having to remember that some rows in the budget table are not budgets, and three of them were
found forgetting it before anyone went looking.

```
budget_node   (company, fiscal_year, code, name, parent_id)          the plan's structure
budget        (node_id, department_id, amount_total, status, …)      the money at one node
```

**A node carries no department.** The first cut of this table gave it one, because their codes are
rooted at departments — `1` is Administration, `19` is Overseas Projects — and 5,699 of 5,715 spend
rows agree. That is the shape of their DATA, and putting it in the schema turned out to break
something else: a control point names a node AND a department node, and if the node already fixes
the department then the department half can never select between budgets. It can only pass or fail
as a whole. Half the coverage mechanism goes dead, and the tests that exercise "same node, different
department" become impossible to write rather than merely unused.

Their own data supports leaving it off: of 556 codes in the 2026 plan, exactly one appears twice,
and that one is the known data error. The codes are already unique company-wide, because the
department is encoded in the code's first segment. Nothing needs the schema to enforce what the
numbering already says, and enforcing it costs the department dimension its meaning.

A node is scoped per fiscal year, like a budget. Nothing in their data asks for a structure that
outlives a year: only 10 of 254 lines carry a prior-year figure at all, and the workbook holds no
second year to compare against. A cross-year chart of budget structure would be a capability nobody
asked for, so it is not built.

The code *displays* the hierarchy; `parent_id` *is* the hierarchy. Neither substitutes for the
other: a code is a string anyone can mistype — theirs cannot even be parsed for depth, since `1.1`
is a category and `1.101` a line beneath it and both carry one dot — and coverage must not depend on
string parsing.

**No account↔budget mapping table.** This is the decision that keeps the change small, so it is
worth stating what is being declined. A mapping would let the system filter the budget picker to
budgets valid for the line's account and flag a mismatch. It would also require someone to maintain
485 budgets × N accounts forever, and to answer "what happens when a requester picks outside the
map — refuse, or warn?" — the question that makes SAP's Funds Management heavy. Because they already
tag every row by hand, the relationship is an observed fact of each transaction, not a rule that
needs declaring in advance. *Alternative considered:* storing the pairing as advisory only, purely
to warn. Deferred rather than rejected — it recovers real safety, and it can be added later without
disturbing anything here, because it reads the same two columns the line already carries.

**GL and budget become independent on the line.** The item still derives `gl_account`
server-authoritatively; the requester names the budget. Choosing a budget SHALL no longer stamp the
line's `gl_account`, which is the current behaviour and the one direction that has to invert. The
existing explicit-budget path is not new machinery — `budgetId` already travels on every line and
already wins when set. What changes is that it stops being a fallback for item-less lines and
becomes the only way a budget is chosen.

**`budget.gl_account` survives, demoted.** It becomes nullable and is read for exactly one thing:
stamping an item-less line's GL when the document type sets no `default_gl_account` — today's
behaviour, preserved. It resolves nothing and identifies nothing. A budget that genuinely spans
accounts leaves it null, and `1.3 vehicle instalments` is exactly such a budget: neither the
principal account nor the interest account is "the" account, so recording one would be a lie the
schema invites. *Alternative considered:* dropping the column outright. Rejected for now only
because it would strand item-less lines on types with no default GL; once every such type carries a
default, the column can go.

**Control points walk the node tree.** `budget_control_point.account_node_id` becomes a
`budget_node`. Everything else about the record is unchanged: same uniqueness shape, same nullable
`cap_amount` (still rejected when set), same tolerance ladder, same "may sit at any node" rule —
which gets *simpler*, because the `account.is_postable` carve-out disappears; every budget node is a
legitimate checkpoint. The department tree is untouched.

In `budget-coverage.service.ts` this is one of two recursive CTEs. `account_up` pairs every account
with its ancestors and itself; `department_up` does the same for departments; the two are joined
against control points. `account_up` becomes `node_up` over `budget_node.parent_id` — the same shape
over a different column. `department_up` is not touched. Company scoping (invariant 1) still comes
from `cp.company_id = fy.company_id` joined through the budget's own fiscal year, so the new tree
inherits the isolation guarantee unchanged rather than needing a new one.

**Money cannot sit anywhere but on a budget, and that is now structural rather than a rule.** The
previous design made categories budget rows holding no `amount_total`, and had to forbid a parent
from holding one — because the ceiling at a control point sums `amount_total` over the budgets it
governs, and a point governs a node together with every descendant. A parent that also held an
amount would contribute its figure alongside the very figures it is the sum of:

```
control point on node 1.1
   governs 1.1     amount_total  534,000,000   ← the total of its children
   governs 1.101   amount_total  350,000,000
   governs 1.102   amount_total   30,000,000
   ceiling = 534,000,000 + 534,000,000 = 1,068,000,000     ← twice the approved money
```

Nothing errors; spending is simply let through, and the effect grows the higher the point sits —
which is precisely where an administrator is advised to start. That was a real defect, caught in
review, and it was answered with a requirement forbidding the shape.

With `budget_node` the shape is not expressible. A node has no `amount_total` column to hold. The
requirement, the validation behind it, and the two tests guarding it all disappear rather than being
enforced. `budget.amount_total` goes back to being NOT NULL, because every row in that table is an
appropriation again.

## Sequence and locking

The reserve path writes `budget_txn`, so its ordering is stated here in full. **Nothing in it
changes**, which is the point of stating it:

```
submit (inside one em.transactional)
  1. resolve each line's budget_id        ← CHANGES: named, not derived from the account
  2. resolve governing control points     ← CHANGES: walks node_up, not account_up
  3. lock those control points FOR UPDATE, ascending by id
  4. sum reserved amounts per budget, fold up to each control point
  5. check every governing point against its tolerance ladder
  6. write one RESERVE per budget_id
```

Steps 3–6 are untouched. The locked row is still `budget_control_point` and still the **only** row
locked — `budget` rows are not locked by any operation that writes `budget_txn`, and that stays true,
so the two-lock-class deadlock the current design forbids remains impossible. Ascending-id ordering
is unchanged, so two documents touching the same points in different orders still cannot deadlock.
Every operation that writes `budget_txn` — settlement and release included — still takes the same
locks in the same order, for serialization rather than for checking.

Steps 1 and 2 are both *reads that select which rows step 3 will lock*. Neither writes, so moving
them to a different tree cannot introduce a race: the lock is still acquired before any availability
is read, and the set of points locked is still the complete governing set.

`quota_usage` is not touched by this change.

## Risks / Trade-offs

- **The strongest existing check is given up.** Today an item-backed line on a `requires_budget`
  type is refused when its account resolves to no `ACTIVE` budget, naming the account, department
  and year. After this, a requester can name a budget that has nothing to do with the expense and
  nothing will object → Mitigated only partially, and deliberately: submit still refuses a line
  naming *no* budget, so money cannot be spent against nothing. Naming the *wrong* budget is what
  the deferred advisory pairing would catch. This is the single largest thing this change trades
  away, and it should be weighed before implementation rather than discovered after.

- **Migrating existing control points is not mechanical in general.** A point sitting on account
  node `61` governs every budget whose account descends from `61`; after the change budgets have no
  account ancestry. → For each existing point, mint a node standing for it and re-parent the nodes
  of the budgets it governed underneath. Coverage is then identical by construction. The seeded data
  is flat and single-level, so this is a real concern only for a populated database.

- **A second table is a second place to get the tree wrong.** `budget_node` can hold a cycle, a
  parent in another department, or a node nothing hangs off → The first two are refused on write,
  as they were when the tree lived on `budget`. The third is deliberately allowed: an empty category
  is a plan in progress, not a fault, and refusing it would make a plan impossible to build
  top-down. What it must not do is silently become an unlimited ceiling — see the requirement that a
  control point governing no budget reports zero.

- **This design reversed once, mid-implementation.** The first version put `parent_id` on `budget`
  and made categories budget rows; roughly half the schema work done under it has to be redone →
  Recorded here rather than quietly rewritten, because the cost is real and because the cause is
  worth not repeating: the consumer trace below was written after the code, not before it. The half
  that survives is the half this change exists for — an account is not a budget's identity — which
  never depended on where the tree lived.

- **Codes must be unique before they can be a key, and the customer's are not.** `3.1` appears twice
  in their 2026 plan with different amounts → Blocks import, not development. Migration assigns
  existing rows their `gl_account` as the code, which is unique within `(fiscal_year, department)`
  by construction because it *was* the key — so the migration itself can never collide.

- **"How much budget does account X have?" stops having an answer** → Accepted and documented in the
  spec rather than left implicit. The question the organisation asks is about the budget node, and
  that one still answers.

- **Every budget-controlled line now needs a human decision.** The requester picks from ~24 budgets
  in their department (117 in Administration) → They already do this on every row today, so it is
  not new work; but it is new work *for the system to make fast*, and the picker must be filtered to
  the document's department and searchable.

## Migration Plan

1. Create `budget_node` (company, fiscal_year, department, code, name, nullable self `parent_id`),
   unique per `(fiscal_year_id, department_id, code)`.
2. Mint one node per existing budget, taking its `gl_account` as the node's code — collision-free
   within the old unique key by construction, because `gl_account` WAS that key, so the migration
   itself can never collide. `budget` gains `node_id` pointing at it, and loses `gl_account` from
   its identity while keeping the column's values.
3. `budget_control_point.account_node_id` → `budget_node_id`. For each existing point, mint a node
   standing for it and re-parent the nodes of the budgets it governed underneath, so the governed
   set is preserved by construction rather than by inspection. An existing point sitting on account
   `61` governs every budget whose account descends from `61`; after this migration budgets have no
   account ancestry at all, which is why the set has to be rebuilt rather than translated.
4. Deploy backend, then frontend. Between the two, the client sends no budget on item-backed lines
   and the server no longer derives one — so **the order must be frontend-aware**: ship the server
   accepting both the derived path and an explicit `budgetId` first, cut the client over, then
   remove the derivation. Three steps, not two.
5. Rollback drops `budget_node` and restores the old unique index while `gl_account` still holds its
   values, which is why step 2 nulls nothing.

Note what step 2 does NOT have to do any more: there is no parent budget to null an `amount_total`
on, and so no assertion that a parent's stored figure equals its subtree before destroying it. That
assertion existed in the previous migration and is gone with the shape it protected.

## Consumer trace

The trace that should have been done before the first line of code, and was not. Every reader of the
`budget` table, and what each has to know:

| Consumer | Needs the tree? | Categories as budget rows | With `budget_node` |
|---|---|---|---|
| `accounting-period` — walks a year's budgets for outstanding holds | no | walks category rows too; harmless but meaningless | sees appropriations only |
| `document.service` — resolves a line's budget | no | must count children to refuse a category | no check needed |
| `listSelectable` — the requester's picker | no | must filter parents out of the options | no filter needed |
| `budget-balance` — sums a ceiling | no | needs `ownAmount()` to read a null as zero | `amount_total` is not null |
| `stores/budgets.ts` — groups the budget list | no | categories fall into the red "ungoverned" fault bucket | categories are not in the list |
| `budget-coverage` | **yes** | walks `budget.parent_id` | walks `budget_node.parent_id` |
| reporting balance report | **yes** | groups by budget | groups by node |

Five of seven do not want the tree at all. Under the first design each of those five had to remember
that some rows in the budget table are not budgets; three were already getting it wrong before
anyone went looking for it. Under this one there is nothing to remember, because what is not a
budget is not in the budget table.

## What would make this wrong

Stated so it can be checked rather than discovered:

- **A node needs a lifecycle of its own** — approval, status, an audit of who created it. Then it is
  a budget after all. *Answered: it needs none.*
- **Two departments share one node**, making the tree a central chart rather than a per-department
  structure. *Measured: in 5,699 of 5,715 spend rows the department code is the first segment of the
  budget code; the 16 exceptions are typos (department 4 against code `1.305`), not a second
  dimension.*
- **Money sits on a node that has children.** *Measured: all 5,715 spend rows charge a childless
  line, and 68 of 78 parents carry exactly the sum of their children.*
- **One code means different things in different departments**, so a node has to be qualified by
  one. *Measured: of 556 codes in the 2026 plan exactly one repeats, and it is the known data error;
  the department is already encoded in the code's first segment.*
- **Budget structure must outlive a fiscal year** to compare across years on one row. *No evidence:
  10 of 254 lines carry a prior-year figure and the workbook holds only 2026.*

Each of the two earlier reversals in this design traces to one of these being unexamined — the first
to the GL-to-budget cardinality, the second to categories-as-budget-rows. All four are now settled,
which is the difference.

## Open Questions

- Does a node need to be retired without deleting it — a category the plan stopped using but whose
  history must stay readable? Nothing in the 2026 data answers this: no line carries a prior-year
  figure and then stops, so there is no retirement to observe. Deferred rather than guessed; the
  column is easy to add and impossible to remove once screens read it.
- Nothing outstanding on the department dimension: it was an open question here, and translating
  the coverage tests answered it — a node carrying a department kills that dimension outright, so
  the node does not carry one. Recorded above rather than left here.

## Deliberately not in this change

Recorded so the next person reads a reason rather than re-deriving one.

- **Monthly / quarterly phasing.** The customer's workbook has a column per month, and their control
  is annual: the ceiling that refuses a request is the year's. Phasing is a second dimension on
  every ceiling, every reserve and every report, and adding it here would have made the node change
  impossible to review. `budget_node` does not block it — a phased amount hangs off `budget`, not
  off the node.
- **An advisory account↔budget pairing.** Tempting, because a requester who picks a budget could be
  offered "the accounts this budget usually posts to". It is a suggestion, not a rule, and a
  suggestion that is wrong once is worse than nothing while people are still learning the new
  picker. Their own books already show the pairing is many-to-many in both directions.
- **Revenue budgeting.** Every budget in this system is an appropriation to spend. A revenue plan
  reverses the sign of the entire ledger, and none of the three customer files contains one.

## The reversal, and what settled it

This change was implemented twice. The first attempt put `parent_id` on `budget` and made a category
a budget row holding no amount. It worked, and it left five separate readers of the budget table
having to know which rows were not budgets — three of which were already getting it wrong.

What settled it was the consumer trace above: listing the seven readers of the budget table and
asking each one whether it wanted the tree. Five did not. That trace is about five minutes of work
and it would have prevented two days of rework, which is the part worth carrying forward — not the
conclusion, which is specific to this table, but the habit of enumerating the readers before moving
a structure into a row.

## 1. The shared mark

- [x] 1.1 `BudgetNode` gains a boolean for "carries shared budget", defaulted so every existing node
      reads as not shared. Migration to match; no backfill — which nodes are shared is the
      customer's statement, not a guess.
- [x] 1.2 The DBML gains the column. Note in the change, do NOT silently fix, that
      `erp_approval_system.dbml` still gives `budget_node` a `department_id [not null]` and keys it
      `(fiscal_year_id, department_id, code)` while the entity carries no department and keys
      `(fiscal_year, code)` — the two disagree before this change touches them.
- [x] 1.3 `PATCH /budgets/nodes/:id` (already `BUDGET_MANAGE`) accepts the field. No new route.
- [x] 1.4 The node read used by the tree returns, per node, whether it is marked and whether it is
      shared through an ancestor — the two are different facts and the screen shows them
      differently.

## 2. The read decides by scope, not by what the client sends

- [x] 2.1 `listSelectable` resolves `ScopeFor('DOC_CREATE')`: `DEPARTMENT` narrows to the caller's
      own department, `COMPANY`/`GROUP` do not narrow. Company scope (invariant 1) is applied first
      and is never replaced.
- [x] 2.2 The `departmentId` parameter stays, but as a FILTER a caller may apply — it can only
      narrow what the scope already allows, never widen it.
- [x] 2.3 Budgets under a marked node are unioned in, whatever the caller's scope and department.
      The subtree walk is the one control-point coverage already uses; reuse it rather than writing
      a second tree walk.
- [x] 2.4 Each returned budget states whether it is shared. Still no `amountTotal`, balance or
      ledger data — the read carries no money and does not start now.

## 3. The screens

- [x] 3.1 The wizard stops sending `auth.departmentId` to the selectable read.
- [x] 3.2 The line's budget picker groups shared budgets separately and labels them, so charging
      money the department does not own is a visible act.
- [x] 3.3 The budget list's tree view offers marking a node to a `BUDGET_MANAGE` user, shows which
      nodes are marked versus shared-by-ancestor, and states how many budgets a mark would cover
      before it is made.
- [x] 3.4 Three locales for any new label.

## 4. Tests

- [x] 4.1 A `DEPARTMENT`-scope caller gets their own department's budgets and no other
      department's.
- [x] 4.2 A `COMPANY`-scope caller in a department holding NO budget gets a non-empty list — the
      case that blocked the budget officer.
- [x] 4.3 A `DEPARTMENT`-scope caller naming another department cannot widen their own scope.
- [x] 4.4 A `COMPANY`-scope caller naming one department gets only that department's.
- [x] 4.5 A budget beneath a marked node reaches a department that does not own it, marked as
      shared.
- [x] 4.6 Sharing does not replace a department's own budgets — both come back.
- [x] 4.7 Marking is inherited down a subtree, and a budget beneath a marked node keeps its
      `department_id` and its governing control points.
- [x] 4.8 Company isolation holds for a shared node in another company.
- [x] 4.9 Marking is refused without `BUDGET_MANAGE`, read off the handler's own decorator.
- [x] 4.10 The picker distinguishes shared from own, and a requester in a budget-less department is
      not offered an empty picker.
- [x] 4.11 The tree offers marking to `BUDGET_MANAGE` and not to `BUDGET_VIEW`.
- [x] 4.12 The existing selectable-budgets, budget-list and create-wizard suites pass unchanged.

## 5. Verify against the people this started with

- [x] 5.1 `LATTANAPHONE` (`DOC_CREATE @ COMPANY`, department BG which holds no budget) opens a
      `SPEND_HIST` draft and is offered budgets. Read the picker; do NOT submit a document against
      the customer's data to prove it.

      Migration applied to `hal_erp` on the user's instruction; every existing node read as not
      shared, nothing backfilled. Verified through the running app as `admin`, whose grants resolve
      to `DOC_CREATE @ COMPANY` in a department holding no ACTIVE budget — the identical code path
      to `LATTANAPHONE`, and reproducible without holding somebody else's password:

      - the OLD call, `selectable?departmentId=<HQ>`, returns `[]` — the empty picker, exactly
      - the NEW call, `selectable` with no department, returns `1.106` and `1.201`
      - marking `1.1 ຄ່າບໍລິຫານ ທົວໄປ` from the plan tree made `1.106` beneath it
        `sharedByAncestor`, and the wizard's picker then showed it under
        `ງົບກາງ — ທຸກພະແນກເບີກໄດ້` FIRST, with `1.201` under its own category below
      - un-marking from the same button put every node back to `is_shared = false`

      The customer's configuration is exactly as it was found: nothing is marked. No document was
      submitted. No console errors.

      **The tree DOES expand in the running app** — 3 root rows became 5 on one click. The
      collapsed-tree limitation is the test harness's alone, so the mark affordance is reachable for
      every node, which was the open risk this task existed to settle.

      **Defect found and fixed while verifying**: the "how far does this mark reach" tooltip read
      *"covers 0 budgets"* on every category, because it showed the node's OWN budget count and a
      category holds none. Marking `1.1` would have shared the twelve million at `1.106` while
      advertising zero. Now counted over the subtree, the way the figures beside it already are, and
      pinned by a test.
- [x] 5.2 Mark `1.100` and `1.400` on a throwaway database — not the customer's — and confirm a
      `DEPARTMENT`-scope user of a department holding nothing is offered exactly those budgets and
      no other department's private lines. Done as a DB-backed spec against `erp_test` rather than
      by hand, so it runs on every commit: `selectable-follows-the-grant.spec.ts`, "are ALL an
      ordinary employee gets when their department owns nothing" — a `DEPARTMENT`-scope caller in
      the budget-less department is offered `['1.406']`, every row shared, and not one line of
      another department's private plan.

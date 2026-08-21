## 1. Schema — entities and migration

> Reworked after the design reversal. What follows replaces the first attempt, which put `parent_id`
> on `budget` and made categories budget rows; see design.md "Consumer trace" for why.

- [x] 1.1 Add a `BudgetNode` entity — fiscal year, `code`, name, nullable self `parent`, unique per
      `(fiscal_year_id, code)` — and record `Table budget_node` in `erp_approval_system.dbml` with
      its `Ref:` lines. The node carries NO department: a node that fixed the department would
      collapse the department dimension of a control point, which is the dimension that lets one
      plan line be governed differently per department.
- [x] 1.2 `Budget` references a node (`node_id`, not null). Remove `code` and `parent_id` from
      `Budget` — they belonged to the first attempt. `gl_account` becomes nullable and leaves every
      key. `amount_total` stays NOT NULL: every row in this table is an appropriation again.
- [x] 1.3 Replace `budget_control_point.account_node_id` with `budget_node_id` referencing
      `budget_node`; update the entity, the unique index, and the DBML Note, which describes the
      account tree today.
- [x] 1.4 Migration: create `budget_node` → mint one node per existing budget taking its
      `gl_account` as the node code (collision-free within the old unique key by construction) →
      point `budget.node_id` at it → swap the unique index → make `gl_account` nullable **without
      nulling a value**, so the rollback has something to restore from.
- [x] 1.5 Migration for control points: mint a node per existing point and re-parent the nodes of the
      budgets it governed underneath, so the governed set is preserved by construction. Assert after
      the migration that every previously governed `(control point, budget)` pair still holds.

## 2. Backend — nodes and budget identity

- [x] 2.1 Node CRUD: enforce `(fiscal_year_id, code)` uniqueness with an error naming the code, not
      a raw constraint violation.
- [x] 2.2 Refuse a node whose parent is in a different fiscal year, and refuse a cycle. Walk the chain rather than trusting the code's shape — theirs cannot be parsed for
      depth at all, since `1.1` and `1.101` both carry one dot.
- [x] 2.3 Allow a node with no budget beneath it: an empty category is a plan being built.
- [x] 2.4 `Budget` requires a node, accepts a null `gl_account`, and stops treating the account as
      part of any lookup key.

## 3. Backend — coverage on the node tree

- [x] 3.1 In `budget-coverage.service.ts`, replace the `account_up` recursive CTE with `node_up` over
      `budget_node.parent_id`, in all three queries in that file. Leave `department_up` and the join
      untouched.
- [x] 3.2 Keep company scoping through `cp.company_id = fy.company_id` joined via the budget's own
      fiscal year, so invariant 1 is inherited rather than re-implemented.
- [x] 3.3 Drop the `account.is_postable` carve-out from control-point placement: any node is a
      legitimate checkpoint.
- [x] 3.4 Ceiling sums `budget.amount_total` over the governed budgets, with no filter and no
      null-handling helper. A category is a node and has no amount to count twice — the double
      ceiling the first design had to forbid is not expressible here.
- [x] 3.5 A control point governing no budget reports a ZERO ceiling, never an unlimited one. This is
      the one thing an empty category must not become.
- [x] 3.6 Confirm by reading, and state in the code, that nothing in the lock path changed — the
      locked row is still `budget_control_point`, still the only row locked, still ascending by id.

## 4. Backend — line resolution

> Done under the first design and unaffected by the reversal: none of it depended on where the tree
> lived. Re-verify rather than rewrite.

- [x] 4.1 Stop deriving `budget_id` from `gl_account`. Keep deriving `gl_account` from the item.
- [x] 4.2 Accept `budgetId` on every line of a `requires_budget` type; validate it is `ACTIVE` and
      belongs to the document's company.
- [x] 4.3 REMOVE the childless check added under the first design — a category is not a budget, so
      there is no id a line could name that would charge one.
- [x] 4.4 Stop stamping the line's `gl_account` from the chosen budget when the line has an item.
- [x] 4.5 Remove the resolve-budget-by-GL read and its route.
- [x] 4.6 Selectable read returns `id`, the node's `code`, `budget_name` and the node's `parent_id`,
      filtered by department. Drop the parent-filtering added under the first design: categories are
      not in the budget table.

## 5. Backend — tests

- [x] 5.1 Two budgets in one fiscal year and department sharing one `gl_account` both exist.
- [x] 5.2 Node rules: a duplicate code in one fiscal year is refused; the same code in the next
      year is accepted; a parent in another fiscal year is refused; a cycle is refused.
- [x] 5.3 A node with no budget beneath it is accepted.
- [x] 5.4 Coverage through the node tree: a point at node `1` governs a budget at `1.101`; a point
      matching only the department tree does not govern; a point never governs across companies.
- [x] 5.5 A point on a leaf node governs that budget alone; a point on a category governs every
      budget beneath it.
- [x] 5.6 A point over an empty category reports a zero ceiling, not an unlimited one.
- [x] 5.7 Two lines whose items derive the same `gl_account` charge two different budgets.
- [x] 5.8 Naming a budget leaves an item-backed line's `gl_account` unchanged.
- [x] 5.9 A positive-amount line naming no budget is refused at submit, leaving the document DRAFT.
- [x] 5.10 A budget of another company, and an inactive budget, are each refused on a line.
- [x] 5.11 Item-less GL precedence: type default wins; the budget's recorded account is the fallback;
      a budget recording no account leaves the line with no GL and is not rejected.
- [x] 5.12 **Concurrency test** (invariant: reserve takes `LockMode.PESSIMISTIC_WRITE`): two
      submissions racing on budgets governed by one point resolved through the NEW tree — exactly one
      succeeds. The tree changed which points are found, so prove the complete governing set is still
      locked before any availability is read.
- [x] 5.13 Deadlock shape still holds: two documents charging budgets under points N and M in
      opposite orders both complete.
- [x] 5.14 Every unit of work that writes `budget_txn` is still wrapped in one `em.transactional()`
      and still locks only control-point rows — assert no `budget` row is locked.
- [x] 5.15 Existing fixtures: the sweep that gave every `em.create(Budget, …)` a `code` was done for
      the first design. Those move to the node — `code` leaves `Budget` entirely.

## 6. Frontend — line editor

- [x] 6.1 Offer the budget selector on every line of a `requires_budget` type, not only item-less
      ones; show the derived GL beside it as read-only, never in its place.
- [x] 6.2 Filter the selector to the document's department; make it searchable by code and by name;
      show `code — budgetName` on each option and no amounts.
- [x] 6.3 Surface a positive-amount line with no budget before submit, naming the line.

## 7. Frontend — budget and control-point screens

- [x] 7.1 Budget create/edit: the NODE is required and presented as the budget's identity, choosable
      from the tree or created inline; `gl_account` optional and presented as a hint; the node not
      editable after creation. Reworked from the first design, which asked for a code and a parent
      on the budget itself.
- [x] 7.2 Create/edit always offers `amount_total`: every budget holds money now, so the
      children-check added under the first design goes.
- [x] 7.3 Budget list: show the node code; present budgets under their nodes with a category row
      totalling what lies beneath, marked as a total rather than an allocation. Built as a THIRD
      presentation rather than a replacement: grouping by control point answers "what will refuse
      me first?", the tree answers "does this match the book we approved?". The tree is not
      paginated, because a subtree total summed over one page is a wrong figure shown as a right
      one. `isRollup` did NOT carry over — it was a field on a budget row, and categories are no
      longer budget rows.
- [x] 7.4 Control-point screens: pick a budget node instead of an account node, with the same
      tolerance-ladder editing as today.
- [x] 7.5 i18n keys for every new label in en / la / zh.

## 8. Reporting

- [x] 8.1 Group the budget-balance report by budget node with subtree rollup, replacing the GL-account
      grouping. Keep ACTUAL as a component and never subtract it (invariant 3).
- [x] 8.2 Test that two budgets sharing one account appear as separate rows rather than merged.

## 9. Verification

- [x] 9.1 Backend and frontend suites green; `vue-tsc -b` clean; `tsconfig.build.json` clean.
- [x] 9.2 Mutation-check the empty-category ceiling: make a point governing no budget fall through
      to an unbounded ceiling and confirm 5.6 fails. This is the one way an empty category can turn
      into a hole, and it raises no error on its own.
- [x] 9.3 Mutation-check the coverage change specifically: revert `node_up` to a self-join with no
      recursion and confirm the ancestor-coverage tests fail. A coverage bug that silently narrows
      the governing set is the failure mode this change can most plausibly introduce, and it does not
      raise an error — it lets spending through.
- [x] 9.4 Drive it in the running app: create two budgets in one department sharing one GL account,
      raise a document with two lines on the same item charging each, submit, and confirm two RESERVE
      rows against the two budgets.
- [x] 9.5 Confirm in Postgres that both `budget_txn` rows carry the right `budget_id`, and that the
      balance for each budget matches the invariant-3 formula.
- [ ] 9.6 Sync the five delta specs into `openspec/specs/` and archive the change.

## 10. Not in this change — record before closing

- [x] 10.1 Note in the archived change that monthly/quarterly phasing, the advisory account↔budget
      pairing, and revenue budgeting were deliberately excluded, so the next person finds the reasons
      rather than re-deriving them.
- [x] 10.2 Keep the record of the mid-implementation reversal — `parent_id` on `budget` → a
      `budget_node` table — together with the consumer trace that settled it. The trace is five
      minutes of work that would have prevented two days of rework, and that is the part worth
      carrying forward.

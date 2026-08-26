## Why

Every budget-controlled line makes the requester name a budget, and the control that asks is a
single flat dropdown. In `ພະແນກ ບໍລິຫານ`, the company's largest department, it holds **92 options**
sorted by a code, six of which read:

```
1.111 — ງົບເດີນທາງ ພນ ບໍລິຫານ
1.112 — ງົບເດີນທາງ ພນ ບຸກຄະລາກອນ
1.113 — ງົບເດີນທາງ ພນ ມາດຕະຖານ
1.114 — ງົບເດີນທາງ ພນ ການຕະຫຼາດ
1.115 — ງົບເດີນທາງ ພນ ສົ່ງເສິມ
1.116 — ງົບເດີນທາງ ພນ ບໍລິການ
```

Six consecutive entries differing in one word, inside ninety-two, with nothing on screen saying what
any of them is for. A requester picks by guessing, and the first anyone hears of a wrong guess is a
figure charged against a budget nobody meant.

**The thing that would organise it is already in the payload and thrown away.** Those six budgets
hang off one parent — `1.11 ເງິນເດີນທາງ ໄປວຽກຕ່າງແຂວງ` — and the 92 fall into ~13 such categories of
three to ten. `GET /budgets/selectable` already returns `parentId`, as
*Selectable Budgets for Document Creation* requires, and `LineItemsEditor` never reads it.

It could not read it if it tried. The parents are **category** nodes that hold no money, so they are
never themselves selectable budgets and never appear in the response: **85 of the 92 budgets carry a
`parentId` that resolves to nothing the client was given.** The field is present, unusable, and
unused.

Found by a browser pass over the document lifecycle (`docs/ui-run-2026-08-26.md`, defect 4).

## What Changes

**The selectable read names the category each budget sits under.**
- `GET /budgets/selectable` returns, per budget, the code and name of its parent node alongside the
  `parentId` it already returns. **BREAKING** for `budget-control`'s
  *Selectable Budgets for Document Creation*, whose current text fixes the response to exactly
  `id`, `code`, `budget_name`, `parent_id`.
- The confidentiality rule is untouched and restated: still `DOC_CREATE`-gated, still no
  `amount_total`, no derived balance, no breakdown, no ledger row. A category's name is a label, not
  a financial figure — which is what makes this fix possible inside the rule rather than around it.
- Where a budget's node has no parent, no category is returned and the budget is offered ungrouped.

**The picker groups by category instead of listing everything flat.**
- Options are grouped under their category, so ninety-two rows become thirteen headings a requester
  reads before choosing — `ເງິນເດີນທາງ ໄປວຽກຕ່າງແຂວງ` explains its six children in a way none of their
  own names can.
- The filter keeps matching a budget's code and name, and matches the category name too, so typing
  the category narrows to its members.
- The filter box gets a placeholder. It works today — a PrimeVue `Select` with `filter`, unlike the
  approval inbox's inert one — but it is an unlabelled box beside a magnifier, and it is the one
  affordance that makes a long list tractable.

**Non-goal, stated because it is the obvious thing to reach for:** showing each budget's remaining
balance. *Selectable Budgets for Document Creation* deliberately gates this read on `DOC_CREATE`
rather than `BUDGET_VIEW` precisely so a requester who may not read budget figures can still raise a
document. Putting balances in the picker would either leak them to that requester or take the picker
away from them. If balances are wanted for users who DO hold `BUDGET_VIEW`, that is a separate,
permission-gated change — not this one.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `budget-control`: *Selectable Budgets for Document Creation* widens its response to carry the
  parent node's code and name, and states why — a `parent_id` that names a category the response
  never contains cannot be resolved by any client. The no-figures rule and the `DOC_CREATE` gate are
  restated unchanged.
- `web-documents`: a new requirement that the line editor's budget control presents the choice in
  the structure the data already has, and that its filter is discoverable.

## Impact

**Build-order capabilities touched:** `budget-control` (one read's projection) and the web layer
over `document-engine` (the line editor). No approval, numbering, quota or FX path is involved.

**Invariants:** none is relaxed, and one is specifically protected. Invariant 1 (company isolation)
is unchanged — the read stays scoped by fiscal year / department. Invariant 3 is untouched: no
balance is computed, returned or displayed, and `budget.amount_total` is neither read nor sent. The
`DOC_CREATE`-not-`BUDGET_VIEW` gate that keeps figures away from requesters is the reason this
change groups by category rather than by money.

**Code**
- `back/src/modules/budget/budget.service.ts` — `listSelectable` populates the node's parent and
  projects its `code` and `name`; `SelectableBudget` gains the two fields.
- `front-end/src/api/budgets.ts` — the widened type.
- `front-end/src/views/documents/LineItemsEditor.vue` — grouped options, category-aware filter,
  filter placeholder.
- `front-end/src/i18n/locales/{la,en,zh}` — the placeholder and the ungrouped heading.

**Data:** none. No migration, no backfill; `budget_node.parent_id` and its `name` already carry
everything the read needs.

**Not in scope:** the budgets admin screens, the report pickers, and any other place a budget is
chosen. They serve `BUDGET_VIEW` holders and have different constraints. Also out: suggesting which
budget a line *should* charge from its item or GL — the server already refuses to derive that
(one account is charged by several budgets), and a suggestion the system cannot stand behind is
worse than none.

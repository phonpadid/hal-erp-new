## Context

`LineItemsEditor` asks for a budget with a single PrimeVue `Select`:

```ts
const budgetOptions = computed(() =>
  props.budgets.map((b) => ({ id: b.id, label: budgetLabel(b) })),
);
```

In `ພະແນກ ບໍລິຫານ` that is 92 options labelled `code — name`, sorted by code. The budgets are a tree
and the list is flat, so six sibling travel budgets appear as six near-identical strings with no
indication that they are siblings or what they are siblings of.

`GET /budgets/selectable` already returns `parentId` — the requirement mandates it — and the editor
ignores it. Using it is not currently possible: the parents are category nodes holding no money, so
they are never selectable budgets and never appear in the response. Measured on the real data:

```
selectable budgets in ພະແນກ ບໍລິຫານ : 92
  with a parentId                    : 92
  whose parent is also selectable    :  7
```

85 of 92 carry an id the client cannot name.

The one thing that would make the choice obvious — how much is left — is deliberately withheld.
*Selectable Budgets for Document Creation* gates this read on `DOC_CREATE`, not `BUDGET_VIEW`, and
forbids `amount_total`, balances, breakdowns and ledger rows, so that a requester who may not read
budget figures can still raise a document. That constraint is the shape of this problem, not an
obstacle to route around.

## Goals / Non-Goals

**Goals:**
- A requester choosing among ninety budgets can tell what each one is for before choosing.
- The structure that already exists in `budget_node` reaches the screen.
- The filter that already works becomes discoverable.
- All of it inside the no-figures rule, with that rule restated rather than eroded.

**Non-Goals:**
- **Balances in the picker.** Discussed under Decisions; rejected on the requirement, not on effort.
- Suggesting which budget a line should charge from its item or GL. The server already refuses to
  derive this — one account is charged by several budgets — and a suggestion the system cannot stand
  behind would be guessed at by requesters exactly as the flat list is.
- Reworking the other budget pickers (admin, reports). They serve `BUDGET_VIEW` holders under
  different rules.
- A full tree control. Two levels is what the data has here and what a dropdown does well.

## Decisions

### 1. The read carries the parent's code and name, not just its id

`parentId` is already specified and already returned. The minimum honest fix is to make it
resolvable: `listSelectable` populates `node.parent` and projects `parentCode` / `parentName`
alongside it.

```ts
// projection stays explicit — the point of this read is what it does NOT carry
return rows.map((b) => ({
  id: b.id,
  code: b.node.code,
  budgetName: b.budgetName ?? b.node.name,
  parentId: b.node.parent?.id,
  parentCode: b.node.parent?.code,
  parentName: b.node.parent?.name,
}));
```

**Alternative considered — return the category nodes as selectable entries and let the client join.**
They are not selectable: a category holds no money and charging a line to one is meaningless. Putting
them in a list whose contract is "budgets you may charge" to serve a display need would make the
response lie about what it contains.

**Alternative considered — a second read for the node tree.** A second round trip, a second thing to
keep company-scoped, for two strings that the row already has in hand.

**Why this is BREAKING.** The current requirement enumerates the response as exactly four fields.
Widening it is a spec change and is written as one, with the no-figures rule restated in the same
paragraph so the widening cannot later be read as licence to add an amount.

### 2. Grouping is the affordance, not balances

The obvious fix — show each budget's remaining balance — is the one this change refuses, and the
refusal is the main decision here.

The read is gated on `DOC_CREATE` precisely so a requester without `BUDGET_VIEW` can raise a
document. Adding balances leaves two options, both bad: leak figures to a requester the permission
model says must not see them, or gate the picker on `BUDGET_VIEW` and take document creation away
from everyone who lacks it.

Grouping achieves what the balance was wanted for. A requester does not usually need to know that
`1.114` has 3,200,000 left; they need to know that `1.114` is the marketing department's travel
budget and their request is not travel. The category name answers that, and it is a label rather
than a figure, so it crosses the permission boundary cleanly.

**If balances are genuinely wanted**, the shape is a separate change: an additive, `BUDGET_VIEW`-
gated enrichment on the same options, rendered only when the caller holds it, so the picker degrades
to today's behaviour for everyone else. Recorded here so the question is not re-opened as if it had
not been considered.

### 3. Two levels, from `optionGroupLabel`

PrimeVue `Select` groups natively:

```ts
const budgetGroups = computed(() => {
  const by = new Map<string, { label: string; items: Option[] }>();
  for (const b of props.budgets) {
    const key = b.parentId ?? UNGROUPED;
    const label = b.parentName ? `${b.parentCode} — ${b.parentName}` : t('…uncategorised');
    (by.get(key) ?? set(by, key, { label, items: [] })).items.push(toOption(b));
  }
  return [...by.values()];
});
```

Order follows parent code, then child code, so a requester who does know the codes still finds them
where they expect. Budgets with no parent land in one labelled group at the end rather than being
scattered or dropped — silently omitting a selectable budget would make a line unbudgetable through
the UI while the server still accepts it.

**Alternative considered — deeper nesting for grandparents.** `1.1` and `1.11` are both children of
`1` in this data, so a third level would add a heading every category shares. Two levels is what
distinguishes.

### 4. The filter matches the category, and says so

`filter` already works — this is a `Select`, not the lazy `DataTable` whose inert `filters` are
defect 1 of the same run. What it lacks is a `filterPlaceholder` and any awareness of the category.

`filterFields` extends to the category name, so typing `ເດີນທາງ` narrows to the travel category's
members rather than only to budgets with that word in their own name. Grouping without this would
trade one scanning problem for another: thirteen collapsed headings still need a way in.

## Risks / Trade-offs

**Widening a read that is deliberately narrow invites the next widening.** → The requirement now
carries the reason for the boundary in the same paragraph as the addition, and the "no figures"
scenario stays. A future field has to argue against a stated rule rather than an implied one.

**Populating `node.parent` adds a join to a read on the wizard's hot path.** → One join on a
department-scoped set — 92 rows at the observed maximum — replacing nothing. Measure before assuming
it matters.

**A category name could itself be uninformative.** → Then the requester is no worse off than today,
and the codes still order the list. The data checked here has meaningful names on all thirteen.

**Grouping changes a screen people have learned.** → The codes and their order are unchanged; the
change adds headings around them. Worth confirming with a requester who uses it daily before it
ships.

## Migration Plan

No migration, no backfill, no data change: `budget_node.parent_id` and `budget_node.name` already
hold everything.

Server and client can land separately — the client tolerates the parent fields being absent (those
budgets fall into the uncategorised group), so the read may ship first and the editor after.

Verified in the browser against `ພະແນກ ບໍລິຫານ`, whose 92 budgets are the case that motivated this:
the control shows ~13 headings, the six `ງົບເດີນທາງ` budgets sit under
`1.11 ເງິນເດີນທາງ ໄປວຽກຕ່າງແຂວງ`, typing that category narrows to them, and no figure appears anywhere
in the control.

Rollback is reverting the commit.

## Open Questions

- **Do requesters want balances enough to justify a `BUDGET_VIEW`-gated variant?** Worth asking the
  people raising documents daily before building it; the answer changes whether decision 2's
  alternative becomes its own change.
- **Should a category with a single child still get a heading?** Consistent, but adds a line of
  chrome for no disambiguation. A judgement to make while looking at the real list.

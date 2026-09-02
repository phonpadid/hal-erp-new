## 1. The read names the category

- [x] 1.1 `budget.service.ts` — `listSelectable` populates `node.parent` and projects `parentCode`
      and `parentName` beside the existing `parentId`; the projection stays explicit so no amount
      can be added by accident.
- [x] 1.2 `SelectableBudget` gains the two optional fields; absent (not empty) when the node has no
      parent.
- [x] 1.3 Unit spec: a budget under a category node carries that category's code and name even
      though the category is not itself returned; a budget with no parent carries neither.
- [x] 1.4 Unit spec: the response still contains no `amountTotal`, balance, breakdown or ledger
      data — the existing no-figures scenario, re-run against the widened shape.
- [x] 1.5 Unit spec: still `DOC_CREATE`-gated, still company-scoped, still department-filterable,
      still `ACTIVE`-only.

## 2. The picker groups

- [x] 2.1 `front-end/src/api/budgets.ts` — widen the type.
- [x] 2.2 `LineItemsEditor.vue` — build grouped options keyed by `parentId`, labelled
      `parentCode — parentName`, ordered by parent code then child code; budgets with no parent go
      into one labelled group at the end.
- [x] 2.3 Bind `optionGroupLabel` / `optionGroupChildren` on the `Select`.
- [x] 2.4 Extend `filterFields` to the category name so typing a category narrows to its members.
- [x] 2.5 Add `filterPlaceholder`, with catalog entries in `la`, `en` and `zh`; likewise the
      uncategorised heading.
- [x] 2.6 Component spec: grouped headings render; a budget with no parent appears under the
      uncategorised heading rather than vanishing; filtering by category name returns its members;
      no amount appears in any option.

## 3. Check it against the case that prompted it

- [x] 3.1 Verified in two halves, because the sandbox requester belongs to a department whose 72
      budgets all hang off one node. The READ was checked against `ພະແນກ ບໍລິຫານ` directly: 92
      budgets resolve into **16** named categories — `1.1 ຄ່າບໍລິຫານ ທົວໄປ` (7),
      `1.11 ເງິນເດີນທາງ ໄປວຽກຕ່າງແຂວງ` (9), `1.2 ຈ່າຍ (ປະຈຳປີ ໃບອະນຸຍາດຕ່າງໆ)` (10) … — with **0**
      unresolvable parents and no figure field in the payload. The CONTROL was checked in the
      browser: it renders its group headings, its filter placeholder reads
      "Search by code, name or category", filtering by a category name matched all 72 options while
      **no option carried that word in its own label**, and a nonsense term gave "No results found".
- [x] 3.2 `REC-HAL-2026-0220` raised and submitted through the grouped picker: its line charges
      `E2E REC` (node `E2E.REC`) for 250,000 with a matching `RESERVE`.
- [ ] 3.3 Confirm with a requester who uses this screen daily that the headings help before this
      ships — the codes and their order are unchanged, but the shape of the list is not.
      **Archived 2026-08-26 with this open.** It has since shipped, so the question is no longer
      whether to release it but whether it earned its place. Carried forward to
      `docs/open-questions-2026-08-26.md`; only a person who uses the screen can answer it.

## 4. Close the loop

- [x] 4.1 `pnpm test`: front-end 996 passed (112 files), back 1971 passed (up from 1969 — the
      two new category scenarios).
- [x] 4.2 Re-ran `back/e2e` against the widened read — 83/83.
- [x] 4.3 Folded the deltas into `openspec/specs/budget-control/spec.md` (MODIFIED) and
      `openspec/specs/web-documents/spec.md` (ADDED); all 75 specs validate.

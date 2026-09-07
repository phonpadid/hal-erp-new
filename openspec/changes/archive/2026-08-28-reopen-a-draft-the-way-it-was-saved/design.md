## Context

The create wizard doubles as the edit screen. In edit mode it loads the document detail and copies
it into the form's refs. Three of those copies were fixed once already — the code carries a long
comment about `warehouse`, `destWarehouse` and `relatedEmployee` arriving as bare ids while
`documentType`, `vendor`, `vendorBankAccount` and `currency` arrive populated, and an `idOf` helper
that takes either shape.

The line mapping was not part of that fix:

```
lines.value = docs.lines.map((l) => ({ description, qty, unitPrice,
  budgetId: l.budgetId,                    // ← undefined; the read returns `budget`
  itemId: l.item?.id ?? l.itemId,          // ← handled
  taxCodeId: l.taxCode?.id ?? l.taxCodeId, // ← handled
}))
```

`item` and `taxCode` are read defensively; `budget` is not. The detail line's keys are
`baseLineAmount, budget, budgetBaseLineAmount, description, document, glAccount, id, lineAmount,
lineNo, lineStatus, qty, receivedQty, taxAmount, unitPrice` — there is no `budgetId` on it.

`moneyMovedOn` is on the document payload and is not copied anywhere, because the field was added to
the create path and the edit path was never revisited.

Both failures are silent: the form opens, the picker is empty and marked required, and a user who
re-picks the budget and saves has also cleared the day.

## Goals / Non-Goals

**Goals:**

- Reopening a draft shows what was saved.
- A value the form cannot restore is visible as missing rather than quietly gone.
- The class of bug — a field added to create and forgotten in edit — is harder to repeat.

**Non-Goals:**

- Changing the detail read's shape. Populating `budgetId` alongside `budget` would fix this one
  field and leave the next one to the same accident.
- Rewriting the wizard into separate create and edit screens. Worth considering one day; not the
  price of fixing a dropped date.

## Decisions

### Read every relation defensively, through the helper that already exists

`idOf` accepts a populated object or a bare id. The line mapping uses it for `budget`, as it already
does for `item` and `taxCode` in longhand.

*Alternative considered — make the read always return bare ids.* Rejected: the detail screen wants
the populated budget to show its code and name, and flattening it would make that screen do a second
read to get back what it just had.

### A field that edit does not restore should be impossible to add quietly

The deeper fault is that create and edit list the document's fields in two places, and only one was
updated. The fix is one list: the fields the form owns, written once, used to build the payload on
save and to populate on load. A field added to that list arrives in both directions or neither.

*Alternative considered — a test that asserts the two lists match.* Weaker: it catches the omission
only if someone remembers the test exists, and it describes the duplication rather than removing it.

### Restoring is not enough on its own — an unrestorable value must show

Where a value cannot be restored — a budget that has since been closed, an item withdrawn — the
field shows as missing and required rather than empty and silent. An empty required picker that the
user simply re-picks is how the day got dropped in the first place.

## Sequence: what writes `budget_txn`

Nothing here writes the ledger. This is a form-population fix on a DRAFT document, before any
submit. It matters *because* of what the ledger does later: a dropped `money_moved_on` sends the
`RESERVE` to today's quarter, and append-only means that row can only be answered, never corrected.

## Risks / Trade-offs

- **[One list for both directions touches the whole wizard]** → more surface than the two-line fix
  the symptom needs. Mitigation: land the field restoration first so the bug is gone, then the
  single list, so the risky refactor is not what the user is waiting on.

- **[A restored value can be stale]** → a budget restored into the form may have been closed since
  the draft was saved. Mitigation: the server validates at submit as it does today; the form shows
  what was saved and lets the server refuse it, rather than silently discarding it on load.

## Migration Plan

Front-end only. Deploy is a normal front-end deploy; rollback is a revert. No data is touched.

## Open Questions

- Should reopening a draft warn when a restored value is no longer selectable — a closed budget, a
  withdrawn item — or leave that to the submit refusal? Warning is friendlier; refusing is the
  behaviour the rest of the form already has.

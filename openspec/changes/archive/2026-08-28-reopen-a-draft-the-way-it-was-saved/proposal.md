## Why

Reopening a draft loses what was saved on it. Pressing ແກ້ໄຂ on a `SPEND_HIST` draft brings back a
form where the line's budget is empty and marked invalid, and the day the money moved is blank —
both were saved, and both are shown correctly on the read-only detail page a moment earlier.

The cause is one line of the edit prefill:

```
lines.value = docs.lines.map((l) => ({ …, budgetId: l.budgetId, … }))
```

The detail read returns each line with a populated `budget`, not a `budgetId` — its keys are
`budget`, `glAccount`, `lineAmount`, `qty`, … — so `l.budgetId` is `undefined` and the picker comes
back empty. The same file already documents this exact trap for three other fields: *"These three
arrive as BARE IDS, not objects … `?.id` on them is undefined and reading it looked like a fix while
changing nothing"*, and carries an `idOf` helper that accepts either shape. The line mapping does
not use it. `moneyMovedOn` is simply not restored at all.

A user who edits an amount and saves will silently drop the day the money moved, and the spend lands
in the quarter they were editing in rather than the one it belongs to. That is the failure the
backdating capability exists to prevent, reintroduced through the edit screen.

## What Changes

- Reopening a draft restores every value the document holds — the line's budget among them —
  regardless of whether the read returns a bare id or a populated object.
- The day the money moved is restored on a type that records past events.
- A value the form cannot restore SHALL be visible as missing rather than silently absent, so an
  edit cannot quietly drop what a save had stored.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-documents`: "Create and Edit a Draft" gains the requirement that reopening restores what was
  saved, and that a value it cannot restore is shown as missing rather than dropped.

## Impact

- **Capabilities touched**: `web-documents` only. No server change: the detail read already returns
  everything needed, in the shape it has always returned it.
- **Invariant risk**: indirect but real. A dropped `money_moved_on` moves a spend between quarters,
  and `budget_txn` is append-only (INVARIANT 2), so the wrong day can only be answered with a
  compensating entry.
- **Code**: the edit-mode prefill in the create/edit wizard — the line mapping and the fields added
  since it was last audited.
- **Related**: the same file already fixed this class of bug once, for `warehouse`, `destWarehouse`
  and `relatedEmployee`. This change is the audit that was not done at the time.

## Context

Two budget screens show columns their readers will try to narrow by, and offer no way to do it.

```
/new/budgets                496 budgets · 21 departments · ACTIVE 478, REJECTED 18 · server-paged
/new/budgets/control-points 474 points  · department NODE · isActive · NOT paged, all on client
```

Both toolbars hold a search box and nothing else. The search box was wired to the server three
commits ago; the columns beside it still cannot be used at all.

The two screens are built differently, and the difference decides where each filter runs.
`BudgetService.list` pages on the server through `paginate`. `BudgetControlPointService.list` does
not page: it returns every point, because each row's ceiling/used/available is resolved for the
whole set in a fixed number of queries, and paging would either break that or reintroduce the N+1
it exists to avoid.

## Goals / Non-Goals

**Goals:**
- Let a department head see their own budgets without paging or guessing.
- Let anyone set aside the 18 REJECTED rows.
- Keep the department dropdown usable by the people who hold `BUDGET_VIEW`.
- Make a narrowed list impossible to mistake for the whole one.

**Non-Goals:**
- A fiscal-year filter. One year exists; a one-option dropdown is furniture. The parameter shape
  below leaves the slot open.
- Filtering by amount, by available, or by overdrawn-ness. Those are report questions, and
  `budget-utilization` is where they belong.
- Saved presets, URL-shareable filter state, multi-select. Each is a real want and none is this.
- The budget screen's tree mode. It is fed by its own full load, has no search box for the same
  reason, and narrowing a tree is a different problem than narrowing a list.

## Decisions

### 1. Server-side on budgets, client-side on control points

Not an inconsistency — the same rule `every-search-box-searches` settled, applied to the same two
screens. A control that narrows must narrow the set the list is drawn from. Where the list holds
one page of 496, that means the server; where it holds all 474 rows, the client already has the
whole set and filtering it there IS filtering the whole set.

Making control points page on the server to match would be the wrong trade: it would put the
derived-figure batching back into a per-page problem for a screen that does not need paging at all.

### 2. Department options come from a read gated with the budget list

`GET /departments` requires `DEPARTMENT_VIEW`. `BUDGET_VIEW` does not imply it, so a department
head reading budgets can be exactly the person the dropdown fails for — empty options, or a 403 the
screen has to swallow.

So `GET /budgets/filter-departments` (name to settle in implementation), gated on `BUDGET_VIEW`,
returning `{ id, name, deptCode }` for the departments that hold at least one budget in the active
company. Two properties fall out of that and both are wanted:

- It cannot be a permission trap, because it is gated with the read it serves.
- It is shorter and truer: 21 departments that have budgets, not every department in the org, so a
  reader never picks an option that yields nothing.

It returns no amounts. `budget-control` already states that the requester-facing budget read "SHALL
NOT return `amount_total`, any derived balance, breakdown component, or ledger row"; this read is
gated higher than that one, but there is no reason for a filter's option list to carry figures, and
a list of names cannot become a side channel.

### 3. Status is a fixed enum, not a discovered set

`DRAFT | ACTIVE | REJECTED | CLOSED` are declared on the entity, so the options are known without
asking the database. Offering only the statuses currently present would make the control's shape
depend on the data — the CLOSED option appearing the day a fiscal year closes, which is precisely
when a reader is looking for it and has never seen it before.

**The default is no status filter, showing everything.** Defaulting to ACTIVE would hide the 18
REJECTED rows by default, which is a decision about what a budget list means, and not one to make
silently on the customer's behalf. Requirement four below is what makes leaving it unset safe.

### 4. Both filters narrow; neither can widen

They `$and` onto the `where` the caller already scoped, exactly as `withSearch` does, and for the
same reason: it is what makes one pattern safe to repeat across endpoints. A department id from
another company matches nothing, because company scope has already been applied — not "found in the
wrong company", simply not found, which is the correct answer and the same one the mapping resolver
gives.

### 5. An active filter says what it is hiding

A search box is self-evident: the term is in the box. A filter can be set, scrolled past, and
forgotten, and then the list is a lie of omission — 59 rows that look like all 496.

So with any filter active the screen states the narrowed count against the total. This is the one
piece of this change that is not "make the control work"; it is the failure the control introduces,
and it belongs in the same change as the control.

## Risks / Trade-offs

**A filter and a search term interact confusingly.** → They compose as AND, which is what a reader
expects from two controls side by side, and requirement 5's count makes an empty result legible:
"0 of 496" with both controls visibly set is not the same as "no budgets exist".

**`filter-departments` is one more read on a screen that already makes several.** → It is small,
cacheable for the session, and the alternative — deriving options from the loaded page — would
offer only the departments on page 1, which is the same class of falsehood as the dead search box.

**Client-side filtering on control points diverges from the budget screen's behaviour.** → Invisible
to the reader: the same two controls, the same narrowing, the same count. The divergence is in
where the work happens, which is a property of the two reads and not of the interface.

## Migration Plan

None. No migration, no column, no backfill, no configuration. The filters are optional query
parameters that an existing read did not previously accept; a client that does not send them gets
exactly what it gets today.

Rollback is reverting the commit.

## Open Questions

- **Should the department filter default to the reader's own department?** It would put a department
  head one click from what they want, but it would also mean two people opening the same URL see
  different lists, and nothing on screen would say why. Left unset here; worth asking a real
  department head once they have the control at all.
- **Is `CLOSED` reachable yet?** No fiscal year has closed in the customer's data, so the option
  will sit unused until one does. Offered anyway — see decision 3.

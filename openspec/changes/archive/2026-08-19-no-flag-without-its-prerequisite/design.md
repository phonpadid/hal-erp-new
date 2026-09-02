# Design — No flag without its prerequisite

## Context

Three flags on `document_type` depend on another flag on the same row, and nothing says so:

```
requires_payee          needs  requires_vendor      a payee IS a vendor's bank account
post_action moves stock needs  requires_warehouse   the warehouse checks sit behind that flag
accrues_on_approval     needs  requires_budget OR requires_vendor   the accrual reads ACTUAL rows
```

`DocumentTypeService` is already the place these are answered: it refuses a second active
`POST_JOURNAL` type, an unknown category, a reserving type with no settlement, and an accruing
self-reserving type that does not settle at its own approval. This adds three more of the same kind.

## Goals / Non-Goals

**Goals:**

- Refuse the three configurations that cannot work, at the moment they are written.
- Name the missing flag in each refusal, so the fix is obvious from the message.
- Keep every rule decidable from one `document_type` row.

**Non-Goals:**

- No runtime change. Each rule describes something already broken; none alters what happens to a
  document whose type is configured correctly.
- No reachability analysis over the pairing graph (see D3).
- No retro-validation of stored types.
- Not the `ValidationError` → 400 fix, though the stock case is one of its two known causes.

## Decisions

### D1. Each rule is decided from one row, and that is what makes it worth having

The three dependencies are all between columns of the same `document_type`. No query, no graph, no
knowledge of who will submit — which is what separates them from the routability question in
`route-only-what-someone-can-approve`, where coverage depended on the requester and had to be
checked at submit instead.

That is also the boundary of this change. Where a rule would need to look further than its own row,
it is not made here.

### D2. Stock is decided from the post-action, never from a list of type codes

Which post-actions move stock is already stated once, in `shared`:

```
STOCK_POST_ACTIONS = ISSUE_STOCK · ADJUST_STOCK · TRANSFER_STOCK
```

introduced by `charge-the-budget-once` for the line editor's item filter, and derived from
`post_action` for the same reason invariant 7 gives: a type's behaviour comes from configuration,
not from branching on its code. The rule reuses that constant rather than restating the set.

Note `ADJUST_STOCK` is in it and does **not** reserve — an adjustment corrects what is already on
the shelf. It still needs a warehouse, because an adjustment has to say which shelf. So the rule is
about naming a warehouse, not about reserving one, and the set to use is the stock-moving one rather
than `RESERVING_ACTIONS`.

### D3. The accrual rule refuses only the case with no possible source

`accrues_on_approval` posts from the document's `ACTUAL` budget rows, and which rows depends on the
vendor:

```
vendor present  →  settlementActuals: walk ref_document_id to the ancestor that was charged
vendor absent   →  the document's own ACTUAL rows
```

So a type has a possible source when it reserves its own budget, or when it names a vendor and can
therefore follow a chain. A type with neither can only ever record a terminal skip, and that is
decidable from its own row.

A type **with** a vendor but with no reference pairing to any predecessor that reserves would also
find nothing. That is a real hole and is deliberately not closed here: it depends on the pairing
graph, which is the next change's subject, and a rule that guessed at it from one row would either
miss cases or refuse workflows that are correct.

The narrow rule and the one `reserve-only-what-something-can-settle` already added are different
halves of the same question, and the earlier one is stricter where it applies:

| type | earlier rule | this rule |
| --- | --- | --- |
| accrues + reserves its own budget | must settle at its own approval | satisfied — it has a source |
| accrues + vendor, no own budget | silent | satisfied — the chain is its source |
| accrues + neither | silent | **refused** |

### D4. The rules bind on active types, on the resulting state

Both follow the neighbours in the same file. `assertNoOtherVoucherType` is applied
`if (docType.postAction === POST_JOURNAL && docType.isActive)`, and the reservation rules read the
entity after every assignment rather than the dto — which is what makes them catch an update that
*removes* a prerequisite, not only a create that never had one.

An inactive type raises no documents, so an incoherent one harms nothing until it is activated, and
activation comes back through the same check.

### D5. Refusals name the missing flag, not the broken one

`requires_payee` on a type with no vendor is not wrong on its own — either flag could be the one the
administrator meant to change. The message says which flag is missing rather than which is present,
because the fix is to add the prerequisite far more often than to remove the dependent.

## Risks / Trade-offs

- **A stored type may already violate one of these**, and nothing looks for it. `XFER_NOWH` on the
  test database is a deliberate example. The rules bind on write, so such a type stays until
  somebody edits it — at which point it is refused, possibly surprising them. Accepted: the
  alternative is a startup scan whose every outcome is worse than the problem, as
  `reserve-only-what-something-can-settle` argued.
- **The stock rule changes a 500 into a refusal at a different time, not into a better 500.** If a
  type slips through — a stored one, edited elsewhere — the submit still answers 500 with
  `ValidationError`. That escape is untouched here and is worth its own change.
- **Refusing `requires_payee` without `requires_vendor` assumes a payee is always a vendor's
  account.** That is true today in both the picker and the submit check. If payees ever broaden to
  employees, this rule is the thing that must change first, and it should be the thing that fails
  loudly rather than quietly permitting a half-built configuration.
- **Three rules in one change is three chances to over-refuse.** The mitigation is that each has a
  test for the configuration it must NOT catch, not only for the one it must.

## Migration Plan

None. No schema change, no data change. Rollback is reverting the commit.

## Open Questions

- **Should `requires_item` be in this set?** A stock post-action with `requires_item = false` reaches
  `demandFor`, which throws `Line N has no item; a stock document must name an item on every line`
  — a clean 400, not a 500. It degrades gracefully, so it is left alone. Worth revisiting only if
  that message turns out to be reachable in a case where it reads as nonsense.
- **`requires_item` with zero lines still submits**, which is a vacuous-truth hole recorded during
  earlier testing and is a different class from anything here.

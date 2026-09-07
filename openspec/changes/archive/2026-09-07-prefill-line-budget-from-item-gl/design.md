## Context

The Create Document wizard's line editor (`front-end/src/views/documents/LineItemsEditor.vue`) carries
a leftover from the design that preceded *Item-Driven GL and Budget Resolution on Lines*:

```ts
function onItemChange(l: EditorLine) {
  if (l.itemId) l.budgetId = undefined;   // the server no longer resolves anything
}
```

Back then the server resolved a line's budget from `(gl_account, department, fiscal_year)`, so an
explicitly-picked `budgetId` on an item-backed line would have been ignored and clearing it was
honest. That resolution was removed — one account is charged by several budgets — and every line of a
`requires_budget` type now needs a budget the requester names. The clear was never removed with it,
so picking an item wipes a budget already chosen, the line shows `budget —` beside its GL chip, and
`needsBudgetPick` blocks the step.

Separately, `openspec/specs/web-documents/spec.md` still describes the removed behaviour in
*Create and Edit a Draft* (item selection auto-fills a read-only budget; the picker is a fallback for
item-less lines only) while *Per-Line Budget Selection in the Create Wizard*, added later in the same
file, describes the current one. Two requirements in one capability contradict each other.

The customer's data (company HAL, FY2026 OPEN):

| `item_company.default_gl_account` | budgets carrying it |
|---|---|
| `5001` | `41168a84` ງົບໃຊ້ໃນການພັດທະນາ IT (dept ພະແນກພັດທະນາເທັກໂນໂລຊີ) |
| `5000` | `3e567002` ງົບໃຊ້ໃນຫ້ອງການ (dept ພະແນກບໍລິຫານ) |

Every pick the wizard demands today has exactly one possible answer, and the maintainer already gave
that answer once on the item-master screen.

## Goals / Non-Goals

**Goals:**

- Stop discarding a named `budgetId` when the line's item changes.
- Offer the obvious budget as a default when the item's per-company GL identifies exactly one
  budget in the already-loaded selectable list.
- Keep the picker visible and editable on every line, so an ambiguous or unmatched account degrades
  to today's behaviour rather than to a wrong guess.
- Remove the contradicting stale requirement text from `web-documents`.

**Non-Goals:**

- Server-side budget derivation. `document-engine`'s *Item-Driven GL and Budget Resolution on Lines*
  stands unchanged: the server derives no budget from `gl_account` and validates whatever
  `budget_id` the client sends (company, `ACTIVE`).
- Storing a `budget_id` on `item_company`. That would be the literal reading of the item-master
  screen's `ງົບປະມານ (ບໍລິສັດນີ້)` column, but it needs a migration, a per-fiscal-year answer
  (`budget` is a per-year row while `item_company` is not), and it would re-couple two facts the
  spec deliberately separated. Rejected — see Decisions.
- Any change to reservation, conversion, release, or the submit-time coverage rule.

## Decisions

### 1. Prefill in the client, from data the client already has

The wizard loads the whole selectable list once in `onMounted`. Adding `glAccount` to that payload
lets the match happen in memory with no extra request per line, no new endpoint, and no server round
trip on every item pick.

*Alternative — a server read `GET /budgets/for-gl/:account`:* one request per item selection, a new
route and permission gate to justify, and it reads exactly like the resolution endpoint the spec
removed. Rejected.

*Alternative — server-side prefill at line save:* indistinguishable from derivation. It would put the
server in the business of choosing a budget, which is the thing invariant-adjacent spec text forbids.
Rejected.

### 2. Exactly-one match, or nothing

```ts
const matches = props.budgets.filter((b) => b.glAccount && b.glAccount === gl);
if (matches.length === 1) l.budgetId = matches[0].id;
```

Zero matches and two-or-more matches both leave `budgetId` untouched. Picking the first of several is
the failure mode the derivation removal exists to prevent — the customer's books put fuel, repairs and
registration on one account, and a silently-chosen wrong budget is worse than an unanswered field
because nothing on screen shows it was a guess.

The list is already department-filtered by the server, so "exactly one in the list" is exactly one
*this document can charge* — a budget on the same account in another department cannot make the match
ambiguous.

### 3. Prefill only into an empty budget

`onItemChange` sets `budgetId` only when the line has none. A requester who deliberately chose a
budget and then corrects the item keeps their choice; the fix and the feature are the same code path.

### 4. `glAccount` is safe on a `DOC_CREATE`-gated read

`budget.gl_account` is an account code, not `amount_total`, not a balance, not a ledger row. It is
already returned to `MASTER_VIEW` holders by `GET /budgets/gl-options`, which exists precisely so an
item-master maintainer can name an item's account by picking a budget. Returning it to `DOC_CREATE`
holders exposes nothing that gate does not already reach.

Absent, not empty, when the budget records none: `listGlOptions`'s own comment establishes that a null
`gl_account` means "spends across several accounts", and an empty string would match an item that has
no GL either.

### 5. Delete the stale `web-documents` text rather than reconcile it

*Create and Edit a Draft* is edited to describe the GL only and to point at *Per-Line Budget Selection
in the Create Wizard* for the budget. Its three budget scenarios are rewritten
(`Picking an item shows its GL read-only`, `Budget picker appears on every line…`) and its
`Unresolvable item line` scenario drops the "whose GL has no active budget for the document's
department and year" clause, which describes a rejection the server no longer performs.

## Risks / Trade-offs

- **A requester accepts a prefill without reading it, and the money lands on the wrong budget.**
  → The prefill fires only when the account admits one answer within the requester's own department,
  so the "wrong" budget is the only one the document could have charged for that account anyway.
  The value is shown in the same selector, with the same label, as a hand-picked one, and the
  approval route still reviews the line.

- **Two budgets are later given the same `gl_account` in one department, and prefill silently stops
  firing.** → Correct by design (decision 2), but invisible: the field simply stays empty, which is
  the pre-change behaviour and is what the required-field message already covers. No new failure
  mode, only the loss of a convenience.

- **Client and spec drift again.** → The stale text is removed in this change rather than left for a
  later cleanup, and the new scenarios name both the match and the no-match cases so a regression
  fails a test rather than a reading.

- **`glAccount` widens the selectable payload.** → One nullable short string per budget on a list
  already capped at one department's budgets (92 in the largest). Negligible.

## Migration Plan

No migration. `budget.gl_account` and `item_company.default_gl_account` are existing populated
columns; no schema, no data backfill, no `budget_txn` or `quota_usage` write.

The change writes no ledger rows and takes no locks: it adds one column to a read projection and
changes a client-side default. There is no transaction boundary to specify, and the reserve path at
submit — which does write `budget_txn` under `LockMode.PESSIMISTIC_WRITE` inside
`em.transactional(...)` — is untouched by this change and continues to act on whatever `budget_id`
the line carries.

Rollback is the revert of two source files; a client still sending a hand-picked `budgetId` against a
server without `glAccount` in the payload keeps working (the prefill simply never fires), so the two
sides can deploy in either order.

## Open Questions

- Should the item-master screen's `ງົບປະມານ (ບໍລິສັດນີ້)` column be relabelled to say it names an
  **account** (via a budget), not a budget? Users read it as a budget binding — that reading is the
  origin of this change. Out of scope here; worth a `web-master-data` follow-up.

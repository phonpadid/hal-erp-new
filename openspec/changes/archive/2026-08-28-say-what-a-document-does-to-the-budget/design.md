## Context

`document_movement` content is written and never read back. `budget_movement` carries
`(document_id, movement_type, to_budget_id, amount, reason)` and is populated by
`BudgetPlanService` and the adjustment/transfer intakes. The document detail read returns
`document`, `fieldValues`, `lines`, `attachments`, `refDocument`, `hasPayment` — it never queries
that table. The approve dialog reads the same payload plus the amount off the document header.

So `BUDGET_PLAN-HAL-2026-0001` renders as a 12,000,000 document with "no items", and LATTANAPHONE
approved it without the screen ever naming budget 1.106.

The reverse direction works: the budget's own page lists the ledger rows each document wrote, so
from a budget you can see its documents. Only the document→budget direction is missing.

`document-engine` already carries the writing half of this split — "A Document Type Declares Where
Its Content Is Authored" exists precisely because `budget_movement` and `journal_voucher` hold
content the generic form cannot reach. Nobody wrote the reading half.

## Goals / Non-Goals

**Goals:**

- A movement document states what it does, on its own page and in the dialog where it is approved.
- The budget it names is reachable from there, so an approver can check the balance the movement
  is about to change.
- A document with no movements still reads exactly as it does today.

**Non-Goals:**

- Journal vouchers. `POST_JOURNAL` has the same shape and the same blindness; no such type is
  configured for this company, and guessing at its presentation without one to look at would be
  inventing a screen for a case nobody has yet.
- Editing a movement from the document. Movements are written by the intake that owns them and
  frozen once approved; this change reads.
- Changing what `budget_movement` stores. Everything the screen needs is already on it.

## Decisions

### The movements come back on the existing detail read, not a second endpoint

One read already assembles everything a document page needs. A separate `/documents/:id/movements`
would mean the page can render before it knows whether the document has content, which is exactly
the state that produced "no items" on a document that has plenty.

*Alternative considered — resolve movements client-side from the budget ledger.* Rejected: the
ledger only has rows once a plan is APPROVED, and the moment that matters most is before that.

### The approval dialog reads the same payload, not its own summary

The dialog already fetches the document to show the proposed amount. It shows the movements from
that same response rather than composing its own view of what the document means. Two summaries of
one document are two chances to disagree, and the one an approver signs against must be the one the
document actually holds.

### A budget is named by code AND name, and links to itself

`1.106` alone is a string an approver cannot check. `ອຸປະຖຳ ສະໜັບສະໜຸນ ອື່ນໆ (ພາກລັດ)` alone does not
match the plan they hold on paper. Both, plus a link, is what makes the figure verifiable rather
than merely displayed.

## Sequence: what writes `budget_txn`

Nothing in this change writes anything. It adds a read to a read.

The movements it displays are written by the intakes that already own them, and turned into
`budget_txn` rows by the post-action at full approval — unchanged here, and stated only so the
reader knows this change sits before that moment rather than inside it.

## Risks / Trade-offs

- **[The detail read gains a query]** → one query for the movements of one document, on a page that
  already issues several. Mitigation: none needed; if it ever matters it joins the existing read.

- **[A movement names a budget the reader may not be allowed to see]** → `BUDGET_VIEW` gates the
  budget page, and a document reader holds only `DOC_VIEW`. Mitigation: show the code, name and
  amount to any document reader — that is what the document says about itself — and let the link
  fail closed the way every other permission-gated link on the screen does.

- **[Journal vouchers stay blind]** → deliberate, and worth writing down rather than discovering
  again from a live approval. Mitigation: this change's requirement is phrased about content held
  outside `document_line`, so the journal case is already in scope of the spec when a type exists.

## Migration Plan

No schema change and no data change. Deploy is a normal backend + frontend deploy; rollback is a
revert.

## Open Questions

None.

## Context

A document's rate is resolved once, at submit, from the company-wide `exchange_rate` table as of the
submit date, and stamped on `document.exchange_rate` (`document-submit.service.ts:287`, `:552`). The
budget base is resolved in the same pass at `BUDGET_RATE`, falling back to the daily rate when no
`BUDGET_RATE` row exists for the pair (`:349-356`), and stamped on `budget_base_total_amount` /
`document_line.budget_base_line_amount`. Reservation and settlement both read the budget base
(`post-action.service.ts:235`), and approval routing compares its bands against it too
(`workflow-step.resolver.ts:84`) — deliberately, "so daily FX doesn't whipsaw budget control /
approval thresholds".

None of that is wrong. What is missing is a way for the person who actually converted the money to
say what they converted it at. On this company's `REC` route they pay at step 3 and accounting closes
at step 4, so at the moment they know the real rate there is still an approval to come — and no field
that reaches the document. The rate they type on the slip reaches the `payment`, and only after the
document completes.

The company also has no `BUDGET_RATE` row for `USD→LAK`, so today the budget base tracks the daily
rate exactly. That is a configuration state, not a permanent one, and the design has to work either
way.

## Goals / Non-Goals

**Goals:**

- Let finance state the rate for one document, at the moment they know it, and have the document be
  worth that.
- Keep the budget honest: the hold follows the restated amount, through the existing services and the
  existing over-limit rules.
- Keep a signature on the final figure: restating is only possible while somebody can still refuse.
- Make the correction attributable: who moved the number, from what, to what.

**Non-Goals:**

- Restating a document that has passed its last approval. The ledger is append-only and the
  approvals are spent; that needs a reversing document.
- Changing the company-wide rate table, or how submit resolves the initial rate. The table remains
  the default a document starts from.
- Re-opening approvals already given. If the business later wants a tolerance above which earlier
  approvers must sign again, that is a separate, additive change.

## Decisions

### D1 — One operation, in one transaction, under the reservation's lock

Restating writes the document, its lines, two `budget_txn` rows and an audit row. Any subset of those
committing alone is a worse state than not restating at all: a document worth one figure holding a
reservation for another, or a ledger that released and never re-reserved.

So it is a single `em.transactional` unit that takes the same `PESSIMISTIC_WRITE` lock on the budget
rows that `BudgetLedgerService.reserve` takes, held across the release and the reserve. Not two calls
that each lock and let go — between them another document's submit could take the room this one is
about to need, and the ceiling check would pass for both.

*Alternative rejected:* release in one transaction, reserve in the next, and compensate on failure.
Compensation for a ledger that must never lose a row is a second correctness problem to get right,
and the operation is small enough not to need it.

### D2 — Re-reserve through `releaseAll` + `reserve`, not a new ledger primitive

`BudgetLedgerService` already has `releaseAll(documentId)` and `reserve(documentId, lines)`, both
accepting a caller's transactional EM. Restating calls them in that order with the recomputed line
amounts. `reserve` already runs coverage and the over-limit policy and already returns warnings, so an
over-`HARD_STOP` restatement is refused by the code that refuses an over-`HARD_STOP` submit — the same
rule, not a copy of it.

*Alternative rejected:* a `readjust` primitive that computes a delta and posts one row. A delta row is
smaller but it hides what happened: two rows say "this document let go of X and took Y", which is what
somebody reconciling the budget needs to see, and it keeps every existing reader of the ledger
working unchanged.

### D3 — What moves is decided the same way at restatement as at submit

The daily rate and the budget base are two different stamps and the change touches them differently:

| | governed by | restatement |
|---|---|---|
| `exchange_rate`, `base_total_amount`, `base_line_amount` | daily rate | **always** recomputed |
| `budget_exchange_rate`, `budget_base_*` | `BUDGET_RATE`, else daily | recomputed **only** when the pair has no `BUDGET_RATE` |

Restating re-runs the same `resolveRate(..., 'BUDGET_RATE')`-with-fallback decision the submit path
runs. A company that configures a `BUDGET_RATE` gets a budget and an approval route that do not move
when finance corrects the day's rate — which is the whole reason that rate type exists. A company
that has not gets today's behaviour, where the budget follows.

The consequence worth stating: with no `BUDGET_RATE`, restating can move an approval band. It cannot
move it under an approver who has already acted (their step is decided), and the re-reservation is
still subject to the over-limit policy — but the honest recommendation that comes with this change is
to configure a `BUDGET_RATE`, which removes the question entirely.

### D4 — `approval_log` gains an action, because that is where this belongs

`approval_log` is the append-only trail of everything that happened to a document, and a change to
what the document is worth, made mid-approval, is exactly that. The blocker is mechanical:
`approval_log.action` carries a CHECK over five values (`APPROVE`, `REJECT`, `RETURN`, `ESCALATE`,
`CANCEL`), so a sixth needs a migration to widen it, plus the `ApproveAction` enum.

The new value is deliberately NOT postable to the approval endpoint — the same treatment `ESCALATE`
already has, for the same reason: a row in the trail that reads as a rate restatement must be
writable only by the code that actually restates a rate.

The before/after rates go in `remark`, which is free text and already carries an approver's note. The
`step_no` is the step the document is waiting on when the restatement happens, so the trail reads in
order against the route.

*Alternative rejected:* a separate `document_rate_change` table. It would be a second history nobody
reads next to the one everybody reads, and the approval screen would have to union them to show a
document's story in order.

### D5 — Stating a rate is its own request, and attaching a slip still carries one

Today the rate is a field on the multipart slip upload, so it only exists as part of attaching a file.
That is what silently discarded a correction: finance typed 23000, attached nothing, and nothing
happened — the screen showed no error because nothing was sent.

So there are two entries to the same operation: `POST /payments/:documentId/rate` with a rate, and the
existing slip upload which continues to carry one. Both funnel into the same service method, so they
cannot diverge.

### D6 — The refusal conditions are read in one place, before anything is written

Three things make a restatement inadmissible: the document is not `IN_APPROVAL`; every approval step
is already decided; a payment exists. All three are cheap reads and all three refuse by name, so the
screen can explain rather than the user guessing from a generic 400. They are checked before the
transaction opens and re-checked inside it, the way `record` already re-reads what
`assertRecordable` just checked — the second read is what catches the instant between.

### Budget, quota, and transaction boundaries

Writes `budget_txn` (a `RELEASE` and a `RESERVE`), never updates or deletes one. Touches no
`quota_usage`: a quota is taken in units, not money, and a rate does not change how many of anything
was asked for. No `payment` row is written or altered — restating is refused once one exists.

## Risks / Trade-offs

- **Steps already approved signed a different figure** → mitigated structurally, not by hope: routing
  bands read the budget base, so with a `BUDGET_RATE` configured no earlier approver's authority is
  exceeded; the re-reservation re-runs the over-limit policy either way; and the change is attributed
  in the trail beside their approvals. Residual risk is a judgement one — an approver who would have
  refused at the new figure — which is why the last step must still be open.
- **No `BUDGET_RATE` configured means the budget moves with a rate finance types** → accepted and
  documented; the re-reservation is subject to the same ceiling as a submit, and the recommended
  configuration removes it. The change ships with that recommendation, not with a silent assumption.
- **A restatement between the ceiling check and another document's submit** → the shared
  `PESSIMISTIC_WRITE` lock serialises them; a concurrency test covers two restatements against one
  budget with room for one.
- **Widening `approval_log.action` touches an append-only table** → the migration only relaxes a CHECK
  constraint; no existing row changes, and rollback re-narrows it (which is safe as long as no row
  used the new value, so rollback is only for a deploy that wrote none).
- **A rate can now be corrected repeatedly** → allowed, and each correction is a `RELEASE`/`RESERVE`
  pair plus a log row, so the history reads as what it is. Nothing about the ledger degrades; the
  document simply has a longer story.

## Migration Plan

1. Widen `approval_log_action_check` to admit the new action. Additive; no backfill; every existing
   row remains valid.
2. Ship the service and the route. Nothing changes for a document nobody restates.
3. Ship the screen. The rate control appears only where the server would accept it.
4. Recommend configuring `BUDGET_RATE` for the company's active pairs — outside this change, but the
   configuration that makes it behave best.
5. Rollback: revert the code; re-narrow the CHECK only if no restatement was written, otherwise leave
   it widened, since the rows are history and must not be deleted.

## Open Questions

- Should a restatement above some percentage re-open the earlier approvals rather than merely being
  logged? Deliberately left out of this change — additive later, and it needs a threshold the business
  states rather than one invented here.
- Should the payment adopt the document's rate rather than the slip's, once the two are guaranteed to
  agree? They will agree by construction after this change, so the adoption stays as it is; worth
  revisiting only if a future change lets them diverge again.

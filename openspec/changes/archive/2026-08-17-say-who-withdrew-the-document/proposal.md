# Say who withdrew the document

## Why

A requester can pull a document out from under the people approving it, and the approval record
says nothing happened.

```ts
// document-submit.service.ts:503 — cancel()
doc.status = DocStatus.CANCELLED;
await em.flush();
await this.releaseDocumentHolds(documentId);
```

That is the whole event. Three things are missing from it, and each is missing for the same reason:
withdrawal was treated as a change of status rather than as an act in the approval process.

**No row in `approval_log`.** `Enum approve_action` runs `APPROVE / REJECT / RETURN / DELEGATE /
ESCALATE`, and none of them is what happened. The history of a document that reached step 2 and was
withdrawn reads: submitted, approved at step 1, then nothing — for a document that is now
`CANCELLED`. Every other terminal outcome writes a row naming its actor. This one leaves the reader
to infer the actor from `created_by` and the timing from `updated_at`, which is exactly the
inference an audit trail exists to remove.

**No event.** `submit` emits `document.submitted`; approve, reject and return all emit
`approval.outcome`. `cancel` emits nothing, so no listener can react — no notification, no
downstream capability, nothing.

**No word to the people who were holding it.** The inbox lists documents by
`status = IN_APPROVAL` (`approval-inbox.service.ts:45`), so the item simply disappears:

```
 09:00  approver opens the document, starts reading the attachments
 09:05  requester withdraws it
 09:06  approver clicks Approve  →  "Document is not in approval"
        their inbox no longer has it and nothing ever said why
```

The withdrawal itself is right, and is not in question: only the creator may do it, only before the
document is finalised (`DRAFT` / `SUBMITTED` / `IN_APPROVAL`), and it releases every hold like a
rejection does (invariant 4). What is wrong is that an act with real consequences for other people
leaves no trace addressed to them.

## What Changes

**`CANCEL` becomes an approval action.** The value joins `approve_action` in the enum, the DBML and
the `approval_log` check constraint. `cancel()` writes the row — actor, `step_no` the document was
sitting on, `acted_at`, and the requester's remark — in the same transaction as the status
transition, so a cancelled document and its explanation commit together or not at all. The row
carries no signature, like `REJECT` and `RETURN`.

**A withdrawal from `DRAFT` is recorded too.** It routed nowhere and interrupts nobody, but the
document existed and someone ended it. `approval_log.step_no` is a non-null int and
`document.current_step_no` is `0` until routing starts, so a draft's withdrawal is logged at step
`0` — the document's own value, and already the number that means "no step reached".

**The act emits an outcome.** `document.cancelled` carries the document, the requester and the
approvers who were pending, alongside the existing `approval.outcome` shape, so notification and any
later listener have the same handle on it that rejection has.

**The people who were holding it are told.** The approvers eligible on the step at the moment of
withdrawal are notified that the document was withdrawn and by whom — resolved before the status
changes, because after it changes there is no current step to resolve them from.

**The history renders it.** `CANCEL` gets its label in the three locales beside the actions already
there, so the document's timeline ends with a line rather than with silence.

Nothing has launched, so the enum and the constraint are altered outright.

## Who this answers

| party | before | after |
| --- | --- | --- |
| approver holding the item | it vanished from the inbox unexplained | told it was withdrawn, and by whom |
| auditor | a `CANCELLED` document with an approval history that stops mid-route | the withdrawal is a row like every other act |
| requester | no way to say why they pulled it | a remark, kept with the act |
| whoever reads the timeline | had to infer the actor from `created_by` | the actor is stated |
| a later capability | could not react to a withdrawal at all | an event, shaped like the others |

## What This Change Does NOT Do

- **Does not change who may withdraw, or when.** Creator only, `DRAFT` / `SUBMITTED` /
  `IN_APPROVAL` only. An approver who wants an in-flight document stopped still uses reject or
  return, which is the correct division: withdrawal is the author's own second thoughts.
- **Does not make withdrawal reversible.** `CANCELLED` stays terminal; a new document is how a
  withdrawn request comes back, and it gets a fresh number and a fresh route.
- **Does not touch hold release.** Cancel already releases budget, quota and stock idempotently
  through the path rejection uses; this change records the act around it and leaves it alone.
- **Does not add a withdrawal request** — asking an approver's permission to withdraw. Some systems
  have it; nothing here needs it while withdrawal is limited to the author's own pending request.

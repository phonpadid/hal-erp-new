## Context

Three write paths reach a document's contents, and only one of them checks the status:

```
   PATCH /:id/payee    setPayee        →  if (status !== DRAFT) throw            ✓
   PUT   /:id/fields   setFieldValues  →  getWith(em, id) … no status check      ✗
   PUT   /:id/lines    setLines        →  no status check                        ✗
```

`setPayee` carries the argument for all three in its own comment: *"DRAFT only: the destination that passed the approval chain is the destination that gets paid, so once the document is submitted nobody — including finance — may redirect it. Returning a document to DRAFT is the only supported way to change the payee, and it costs a fresh trip through every approval step, which is the point."*

The gap is invisible in normal use because the web app never exercises it. `DocumentDetailView` computes `canEdit` as `auth.can('DOC_CREATE') && doc.status === 'DRAFT'`, and the edit route is only reachable from that button. So the rule is enforced — in the client, which CLAUDE.md is explicit does not count.

An external integration is now writing to these endpoints, which is how the gap surfaced: writing the integration guide meant reading what actually enforces "frozen at submit", and the answer was the payee only.

## Goals / Non-Goals

**Goals:**
- What an approver signed is what takes effect.
- The server enforces the rule the client already shows.
- The refusal is machine-readable, so an integration can tell it from a payload error.

**Non-Goals:**
- Freezing attachments. An approver asking for another photo is part of deciding, and evidence added later cannot change what the document says. This was answered explicitly to the claim team and stays true.
- Freezing anything after `REJECTED` or `CANCELLED` beyond what the DRAFT rule already implies — those are terminal and nothing edits them anyway.
- An audit of who changed what. If a change is refused, there is nothing to audit; the existing `approval_log` remains the record of decisions.
- Any web app change. There is nothing to change: the button is already gated.

## Decisions

**Guard both methods at the service, not at the controller.**

`setPayee` guards in the service, and the two new guards belong next to it for the same reason: a second caller of `setFieldValues` written later inherits the rule. A controller guard protects one route.

**`DRAFT` only, matching the payee exactly.**

Not "not yet approved", not "before IN_APPROVAL". The payee rule is `status !== DRAFT`, the return path puts a document back to `DRAFT`, and having two documents-are-editable rules that differ by a status would be a bug waiting to be written. One rule, one status, one sentence to remember.

**`INVALID_STATE`, the code that already exists.**

The submit guard and the settle guards already answer with it, and it means exactly this: the operation does not apply to the document's current state, so stop rather than retry. No new code is needed and none should be invented — the code list grows only when a caller would react differently, and a caller reacts to this the same way it reacts to submitting a document that is already submitted.

*Alternative — a distinct `DOCUMENT_FROZEN` code.* Rejected on that rule.

**Say it in the message, not just the code.**

The message names the way out: return the document to `DRAFT` and it becomes editable, at the cost of the whole approval chain running again. That is the same sentence `setPayee` uses, and it is the difference between an error a person can act on and one they file a ticket about.

**No transaction or lock.** Two guards on existing service methods. Nothing new is written; something stops being written.

## Risks / Trade-offs

**A caller might be editing submitted documents today and would start failing** → the web app is not, verified by reading the only path into its edit view; the one external integration was told a week before this shipped to treat a submitted document as read-only, and the guide carries that warning. Anything else was relying on a gap that leaves an approval log describing a document that no longer exists.

**A legitimate correction after submit becomes more work** — return, edit, resubmit, re-approve → that cost is the feature. It is what the payee rule already charges, and the reason it charges it is that a signature has to mean something.

**Someone could route around it by cancelling and creating a new document** → they could, and that is fine: a new document gets its own number, its own approval, and its own trail. What matters is that the approved one stays what it was.

**The rule is now in three places and could drift** — payee, fields, lines → all three read `status !== DRAFT` against the same enum, in the same service, and a spec scenario covers each; if a fourth writable surface appears, the pattern to copy is unmistakable.

# Lock the route at submit

## Why

This codebase snapshots everything an interested party could later dispute, and says why each
time:

```
locked FX rate       stamped at submit, never recomputed              invariant 6
signature_id         stamped at APPROVE, unaffected by a later change approval-workflow
payee bank details   snapshot on the batch line, not joined live      payment-batch
the exported bytes   stored, so a re-download is the same file        payment-batch
budget basis         the locked rate, not the rate on the day paid    invariant 3
```

One thing is not snapshotted: **the approval route**. It is also the thing an auditor asks about
first — *who did this document have to pass, at the time it passed?*

A routing document remembers a single integer, `current_step_no`. Everything else — how many steps,
who approves each one, in what mode, with what SLA, and how many signature blocks its PDF carries —
is read live from `workflow_step` every time anything is asked:

```
approval-routing.service.ts:268   advance reads applicableSteps() again
approval-routing.service.ts:198   act() looks up the step by number, live
sla.service.ts:77                 the SLA sweep looks it up, live
approval-inbox.service.ts:55      the inbox looks it up, live
document-pdf.service.ts:207       the signature blocks are built from it, live
```

Five consequences follow, and they are not five problems:

**A document's SLA clock never restarts.** `sla.service.ts:84` measures every step from
`document.submittedAt`, because that is the only start time in existence. Step 2 therefore inherits
whatever step 1 spent. On a three-step route with a 24-hour SLA, one approver taking two days leaves
step 2 already overdue the moment it opens — the sweep escalates it before its approver has seen it,
then does the same to step 3 on the next pass. The longer the route, the fewer approvals actually
happen.

**An issued PDF is not stable.** The signature blocks are the flagged steps of the live workflow.
Edit the workflow after a document is approved, printed and signed, and re-exporting the same
document produces a different sheet — different block count, different names, different order. This
is the same argument `payment-batch` already makes about the exported bank file, applied to the
document that carries handwritten signatures.

**Configuration is frozen instead of versioned.** Because routing reads live rows, `updateStep` and
`deleteStep` refuse while any document of that workflow is in flight. In a company where documents
are always in flight, that is *never*. The administrator's remaining move is to build a second
workflow and re-point the mapping, which loses the connection between the old route and the
documents that ran on it — a worse audit outcome than the edit that was blocked.

**`PARALLEL_ALL` means "everyone who holds the role right now".** `stepComplete` resolves principals
at the moment of each check (`approval-routing.service.ts:94`). Grant the role to someone new while
a step is half-approved and the step needs one more approval than it did a minute ago; revoke it and
a step can complete on approvals from people who no longer hold it. Neither is a decision anyone
made about that document.

**A step added mid-flight is silently skipped or silently required.** Covered in
`honour-every-field-the-api-accepts`, which closes it by refusing the edit. The refusal is the
symptom's treatment; this is the cure.

## What Changes

**The applicable steps are written down when the document is submitted.** A new
`document_approval_step` table holds one row per step the route will run, resolved once through the
existing engagement rules (amount band, requester job level) and never re-derived:

```
  document_approval_step
  ├─ document_id, step_no                 the route as it stood at submit
  ├─ step_name, approve_mode, sla_hours   copied, not joined
  ├─ approver_role_id / approver_user_id  the target as configured then
  ├─ show_signature_on_pdf                so an issued sheet stays the sheet
  ├─ status, started_at, completed_at     per-step lifecycle and per-step clock
  └─ source_workflow_step_id              traceable back to the configuration used
```

Routing, the SLA sweep, the inbox, the pending-approver read and the PDF all read this table. The
document keeps a pointer to the row it waits on; nothing consults `workflow_step` again for a
document already submitted.

**Each step gets its own clock.** `started_at` is stamped when a step opens — at submit for the
first, at advance for the rest — and the SLA is computed from it. This is what
`sla_hours` always meant: it is configured per step, so it must be measured per step.

**The participant set is fixed when the step opens.** `PARALLEL_ALL` completes against the
principals recorded on the step instance, not against whoever holds the role at the moment of the
check. A role membership change alters who approves the *next* document, which is what a role
membership change should do.

**Configuration stops being frozen.** `assertNoInFlight` goes. An administrator may edit or delete a
step whenever they like: the change reaches documents submitted afterwards, and cannot reach one
already routing, because that document is no longer reading configuration. The rule the guard was
protecting is now a property of the data rather than a prohibition on the administrator.

**Resubmission re-materialises.** `RETURN` sends a document back to `DRAFT` and a rejected document
may be revised; on the next submit the route is resolved again from current configuration, and the
previous route rows are superseded rather than reused — a resubmitted document is routed by the
rules in force when it was resubmitted, and each attempt keeps its own record.

Nothing has launched, so the table is added outright and no route exists to backfill.

## Who this answers

| party | what they could not do | after |
| --- | --- | --- |
| auditor | know the route a document actually ran | it is a row per step, kept with the document |
| approver | get the time the SLA promised them | the clock starts when the step reaches them |
| holder of an issued PDF | rely on the sheet they signed | the blocks come from the route, frozen at submit |
| administrator | edit a workflow in a busy company | edits apply to new documents and reach no in-flight one |
| requester | see a stable list of who is left | the remaining steps are recorded, not recomputed |
| a role's new holder | — | is not silently added to an approval already under way |

## What This Change Does NOT Do

- **Does not change who is eligible.** The resolver, delegation, the no-self-approval rule and the
  engagement conditions all keep their current meaning; they are evaluated against a recorded step
  instead of a configured one.
- **Does not change escalation semantics.** Fixing the clock removes the cascade, but a timed-out
  step still forwards past its approver until `escalate-to-someone-not-past-them` lands. That change
  builds directly on the rows this one introduces.
- **Does not add quorum or ad-hoc approvers.** `min_approvals` (N-of-M) and inserting an extra
  approver on one document are the two features this table makes cheap, and both are real feature
  decisions with their own permission questions. Naming them here is a promise that they no longer
  need a schema change, not a commitment to build them now.
- **Does not touch `approval_log`.** It stays append-only and keeps `step_no` as a value rather than
  a reference, so history survives any later configuration change exactly as it does today.
- **Does not change the budget, quota or posting paths.** Submit still reserves, reject and cancel
  still release, full approval still runs the post-action.

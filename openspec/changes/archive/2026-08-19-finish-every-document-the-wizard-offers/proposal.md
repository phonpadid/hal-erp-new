# Finish every document the wizard offers

## Why

The create wizard lists every document type mapped to the user's department and presents each one
the same way: four steps, a **Save and submit** button at the end. Twelve of the nineteen seeded
types cannot produce a document that does what the type promises. The wizard offers them anyway, and
the user finds out at the last click — or, for five of them, not until an approver clicks too, or,
for two, never at all.

```
                       wizard offers    can it author the content?   fails at
 ISSUE                      yes          no warehouse field           submit
 STOCK_ADJ                  yes          no warehouse field           submit
 STOCK_XFER                 yes          no warehouse, no dest        submit
 LEAVE                      yes          quantity is system-computed  submit
 OT                         yes          quantity is system-computed  submit
 BUDGET_PLAN                yes          content is budget_movement   APPROVAL
 BUDGET_ADJ_INC             yes          content is budget_movement   APPROVAL
 BUDGET_ADJ_DEC             yes          content is budget_movement   APPROVAL
 BUDGET_TRANSFER            yes          content is budget_movement   APPROVAL
 JV                         yes          content is journal_voucher   APPROVAL
 PROMOTE                    yes          cannot name the employee     NEVER — silent no-op
 RESIGN                     yes          cannot name the employee     NEVER — silent no-op
```

Twelve of nineteen. Every one was walked through the wizard with a mouse on a seeded database and
the resulting rows read back out of Postgres.

**Four families, one shape.** Each of these types keeps its content somewhere the generic form
cannot write:

- **Stock** — the movement needs `document.warehouse_id`, and `TRANSFER_STOCK` a `dest_warehouse_id`
  as well. `document-submit.service.ts:144` refuses a submit without one. The DTO accepts both
  fields (`document.dto.ts:122,127`), so the server is ready; the client never sends them, and
  `requiresWarehouse` is absent from both `GET /documents/creatable-types` and
  `GET /documents/types/:id/form`, so the form could not branch on it even if it wanted to. The
  string `requiresWarehouse` does not appear anywhere in `front-end/src` outside an i18n label.
- **Leave and overtime** — `derives_quantity` types, whose days and hours are counted from the shift
  and the holiday calendar. The generic endpoint refuses them by design and names the endpoint that
  owns them. That endpoint already has a client (`api/attendance.ts:112-114`), so the wizard is
  offering a second, broken door to a room that already has one.
- **Budget movements and vouchers** — a plan, an adjustment and a transfer carry their content on
  `budget_movement`, authored by the budget screens; a journal voucher carries its debit and credit
  lines on `journal_voucher`, authored by the voucher screen. In both cases step 2 of the wizard
  renders no fields at all, because the form template has none, and the wizard creates the
  `document` and nothing else. `BUDGET_PLAN-HAL-2026-0001` and `JV-HAL-2026-0001` both reached
  `IN_APPROVAL` carrying zero lines and a zero total.
- **The HR pair fails in the opposite direction — it succeeds.** `UPDATE_EMPLOYEE` and
  `TERMINATE_EMPLOYEE` act on `document.related_employee`, and the wizard has no field that sets it:
  `PROMOTE-HAL-2026-0001` and `RESIGN-HAL-2026-0001` were both created with
  `related_employee_id` null. Both post-actions open with `if (!document.relatedEmployee) { log;
  return; }`, so these documents will route, be approved, and reach `COMPLETED` having promoted and
  terminated nobody. That is worse than the budget family, which at least refuses: here an approver
  signs a promotion, the system reports success, and no employee record changes.

**The budget and voucher family is serious because it fails after approval starts.** A requester can
create an empty budget plan — no lines, zero total — and submit it. It enters the approval queue and
looks like work. The approver opens it, clicks Approve, and the post-action refuses:
`No budget_movement rows for budget plan …`. The transaction rolls back cleanly (`approval_log`
stays empty, which is correct), so the document returns to the queue unchanged, and no amount of
clicking will move it. It can only leave by being withdrawn. Verified end to end:
`BUDGET_PLAN-HAL-2026-0001` is still sitting in the approver's queue.

Costing an approver's attention is worse than costing the requester's, because the requester at
least knows what they were trying to make.

**Why the error message is not the fix.** The server's refusals are specific and the UI does show
them — `A warehouse is required for this document type`, and for leave a message that names the
correct endpoint. That is the system behaving well. It does not help: a message telling someone a
warehouse is required is no use on a screen with no way to name a warehouse. The defect is that the
path was offered, not that the refusal was unclear.

## What Changes

**A type the wizard cannot carry to a submitted document SHALL NOT be offered as though it can.**
That is the single rule; the remedy differs by family because the four families are different
problems wearing the same symptom.

**Stock types — build the missing fields.** This is the family the specs already promised:
`web-inventory` describes a form "offering a warehouse selector when the type's `requires_warehouse`
is true and a destination warehouse when its `post_action` is `TRANSFER_STOCK`", and that form does
not exist. `creatable-types` and the form endpoint gain `requiresWarehouse` and `post_action`, the
wizard grows the two selectors, and the submit sends `warehouseId` / `destWarehouseId` to the DTO
fields already waiting for them. Nothing on the server changes.

**Leave and overtime — send the user to the door that works.** These types keep their place in the
list, because a requester looking for "leave" should find it where documents are made. Choosing one
routes to the capability that owns it rather than continuing into a generic form whose submit is
guaranteed to be refused.

**Budget movements and vouchers — offered where their content is authored.** A plan, an adjustment
and a transfer are raised from the budget screens, which is where the budgets they move are visible;
a voucher is raised from the voucher screen, which is where its two sides can be balanced. The
wizard stops presenting them as generic documents it can complete.

**The HR pair must name its subject.** A promotion or a resignation SHALL carry the employee it acts
on before it can be submitted, so the post-action cannot be handed a document with nothing to act on.
A no-op is the right behaviour for a post-action given no subject; producing such a document from a
form that never asked is not.

**No empty budget plan reaches an approver.** Whatever the route in, a budget document with no
movement SHALL be refused at submit rather than at approval. Moving the refusal one step earlier is
what keeps a malformed document out of somebody else's queue, and it is cheap: the check the
post-action already performs, performed sooner.

## Who this answers

| party | what happened | after |
| --- | --- | --- |
| a requester raising a goods issue | filled in four steps, then learned a warehouse was required, with nowhere to put one | names a warehouse and submits |
| a requester raising leave | reached a submit the server is built to refuse | lands in the flow that computes the days |
| an approver | an empty plan in the queue that cannot be approved and will not go away | never sees it |
| an approver of a promotion | signed it, and nobody was promoted | the document names whom it promotes, or cannot be submitted |
| whoever reads `web-inventory` | a spec describing a screen that was never built | the spec and the screen agree |
| whoever adds the next post-action | no rule about whether the wizard can author its content | the rule is written down |

## What This Change Does NOT Do

- **Does not change any refusal on the server.** Every guard named here is correct and stays exactly
  as it is. The change is about which paths are offered, and where a refusal that must happen
  happens.
- **Does not change how errors are surfaced.** They are already toasted with the server's own
  message, for six seconds, from a single feedback seam. This was initially reported as a defect
  during testing and was wrong — a MutationObserver on the toast host caught the error toast
  appearing and expiring exactly on its configured life. The screenshots that appeared to show
  nothing were taken after it had gone.
- **Does not remove any document type.** All nineteen stay configured, routable and approvable; this
  is about which screen raises them.
- **Does not touch `dept_doc_type` mapping.** Which types a department may raise is configuration and
  stays configuration; this is about whether the wizard can finish what the mapping allows.
- **Does not build a budget-movement authoring step into the wizard.** Making the generic form able
  to write `budget_movement` would duplicate the budget screens, which already do it against a view
  of the budgets being moved.

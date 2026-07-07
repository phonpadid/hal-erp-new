## Why

The Approval Workflow capability (build-order step 8) is ~80% delivered: step modes,
role/person approvers, delegation, reject→release→resubmit, the append-only audit
trail, the approver inbox, and the post-action engine all work end to end with tests.
Three gaps stop it from matching the documented behaviour and the business ask:

1. **Conditional routing is not actually evaluated.** `workflow.condition_json` is
   stored but never read; routing picks the single workflow mapped to a
   department+document-type and cannot branch on **amount range** or **position level
   (`app_user.job_level`)**. The longer-chain-by-amount scenario in the spec has no
   evaluator behind it.
2. **SLA escalation never fires.** Working-day SLA due-time computation (company
   holiday calendar) and overdue notification exist, but `SlaService.escalate()` is
   never triggered by a scheduler and there is no auto-forward to the approver's
   superior — overdue documents just sit.
3. **The web config and inbox don't expose it.** The workflow-step admin UI has no
   amount-range, no per-person approver, and no level-condition fields; the approver
   inbox and document detail show no SLA due-time, overdue badge, or escalation status.

## What Changes

- **Backend — conditional workflow/step selection.** Evaluate `workflow.condition_json`
  (amount band + `job_level`) when binding a submitted document to a workflow, and keep
  the existing step-level `amount_min`/`amount_max` band filtering. Add a unit test that
  proves amount and level pick the correct chain.
- **Backend — SLA escalation engine.** A scheduled sweep that, for each overdue
  `IN_APPROVAL` step with no active delegation, escalates per the configured policy
  (forward to the next step / the approver's superior) inside a transaction, notifies
  the new actor, and records the escalation in `approval_log`. Working-day computation
  continues to use the company holiday calendar. No-self-approval still holds after
  reassignment.
- **Frontend — workflow-step config.** Add amount-range (`amountMin`/`amountMax`),
  per-person approver (`approverUserId`), and position-level condition inputs to the
  step editor, mirrored by the shared Zod schema; surface the workflow's level/amount
  selection condition.
- **Frontend — SLA & escalation visibility.** Show due-time, an overdue badge, and
  escalation status on the inbox rows and the document detail timeline.

## Capabilities

### New Capabilities
<!-- None — all behaviour belongs to existing capabilities. -->

### Modified Capabilities
- `approval-workflow`: make conditional workflow selection evaluate amount-range and
  `job_level` from `condition_json`; turn SLA escalation from a never-called method into
  a triggered, auto-forwarding, auditable engine.
- `web-doc-config`: the workflow-step editor SHALL expose amount range, per-person
  approver, and a position-level selection condition.
- `web-approvals`: the inbox and document detail SHALL surface SLA due-time, overdue
  state, and escalation status.

## Impact

- **Backend:** `approval` module — workflow binding/selection service (new
  `condition_json` evaluator), `sla.service.ts`, a scheduled escalation trigger
  (extending `notification.scheduler.ts`), `approver-resolver.service.ts` (superior
  lookup), `approval-routing.service.ts` (escalation log). New unit + concurrency tests.
- **Frontend:** `front-end` app — `DocConfigView.vue` step editor,
  `ApprovalInboxView.vue`, `DocumentDetailView.vue` / `EventTimeline.vue`, the approvals
  Pinia stores, and the shared workflow-step Zod schema.
- **Data model:** no new tables — uses existing `workflow.condition_json`,
  `workflow_step.amount_min/amount_max/sla_hours`, `app_user.job_level`, and
  `holiday_calendar`.
- **Invariants:** must preserve append-only `approval_log` (escalation is a new row),
  no-self-approval after reassignment, company scope, and permission-code guards
  (`WORKFLOW_MANAGE`, `DOC_APPROVE`). No budget/quota balance logic changes.

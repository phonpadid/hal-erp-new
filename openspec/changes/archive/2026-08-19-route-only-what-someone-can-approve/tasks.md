# Tasks — Route only what someone can approve

## 1. A step must name someone

- [x] 1.1 `WorkflowConfigService` refuses a step of an **active** workflow that has neither
      `approver_role_id` nor `approver_user_id`. Joins the four checks already there
      (`amount_min ≤ amount_max`, unique step number, role and user of the active company).
- [x] 1.2 Check **the resulting state, not the dto** — an update that clears the only approver must
      be refused as surely as a create that never set one. This is the discipline
      `assertNoOtherVoucherType` states in `document-type.service.ts`, and the reason the rule
      catches both directions.
- [x] 1.3 A role with no current holders stays valid (D1). The rule reads what the configuration
      names, never who holds it — staffing is answered elsewhere and changes daily.
- [x] 1.4 The rejection names the step, so an administrator editing a long workflow knows which row
      to fix rather than which service complained.
- [x] 1.5 **Checked first, as the design asked.** `WorkflowStepCreateView` is a single form with a
      single save — a new step's `initialValues` carry only `workflowId`, `stepNo`, `approveMode` and
      `showSignatureOnPdf`, and everything else is filled before submitting. There is no
      create-then-fill flow, so the rule can bind on every write without turning a normal edit into
      an error. Also found: `workflowStepSchema.superRefine` in `shared` currently mirrors only the
      server's `amountMin ≤ amountMax`, so the approver rule belongs there too — one refinement,
      both runtimes, the way `isFieldVisible` is shared.

## 2. A document must have somewhere to go

- [x] 2.1 Resolve applicability during submit, **above the transaction**, beside the vendor / payee /
      warehouse / employee gates — the ones whose comments say they run "before any hold is taken,
      so a rejected submit leaves the document DRAFT with nothing reserved".
- [x] 2.2 Refuse the submit when no step applies, naming the workflow. The document stays `DRAFT`.
- [x] 2.3 Use the SAME resolution routing uses (`applicableSteps`: amount band **and**
      `condition_json` against the requester's level). A second implementation of "does a step
      apply" would be a copy free to disagree with the router — which is the defect class this
      whole run of changes has been closing.
- [x] 2.4 Do NOT add a config-time coverage rule (D3). Coverage depends on who submits, which the
      configuration cannot know, and proving it would refuse workflows that are correct for the
      people who use them.
- [x] 2.5 Leave `approval-submitted.listener.ts` and its log exactly as they are. It is the net for
      workflows already stored, and for anything that changes between the gate and the listener.

## 3. Tests

- [x] 3.1 A step with neither approver is refused on create and on update; the message names the
      step.
- [x] 3.2 A step naming a role with zero holders is accepted — the case the rule must NOT catch.
- [x] 3.3 Clearing the only approver on an existing step is refused (the both-directions case that
      a dto-shaped check would miss).
- [x] 3.4 A document whose workflow has no applicable step is refused at submit and stays `DRAFT`.
- [x] 3.5 **That refusal reserves nothing** — no `budget_txn` row for the document.
      **The claim that this proves the ordering was wrong**, and mutation showed it: moving the gate
      inside the transaction, after the reserve, leaves all of these tests green, because the
      rollback produces the same observable state. Added `never even attempts the reservation`,
      which spies on `BudgetLedgerService.reserve` — that one does fail when the gate is moved, and
      is the only assertion here that distinguishes "refused before the work" from "did the work,
      then undid it".
- [x] 3.6 A document that IS routable still submits and still reaches `IN_APPROVAL` at the first
      step — the gate must not refuse the normal case.
- [x] 3.7 The gate agrees with the router: a document the gate accepts is one `routing.start()`
      routes without throwing. Worth asserting directly, since 2.3 is a claim about two callers
      staying in step.
- [x] 3.8 Mutation-checked, five mutations, all caught:

      | mutation | result |
      | --- | --- |
      | approver rule removed | caught (3) |
      | update no longer re-checks the resulting state | caught (1) |
      | rule ignores `isActive` (would refuse inactive workflows) | caught (1) |
      | submit gate removed | caught (3) |
      | submit gate moved INSIDE the transaction | **survived**, until the spy in 3.5 was added |

      Restored from a scratch copy each time, never `git checkout`.

## 4. Verification

- [x] 4.1 back `npx vitest run` — **one run at a time**; two concurrent suites share the test
      database and both call `dropSchema`/`refreshDatabase`, which produces mass failures that look
      like a regression (the tell is the skip count jumping). Expect the known date-dependent
      attendance-correction failure. `tsc -p tsconfig.build.json --noEmit` (**not** `nest build`
      while `start:dev` is watching).
      → 1612 passed / 1 failed — the known date-dependent attendance-correction test, unrelated. Skips back at 36, which is how this run is known to be clean: the three earlier runs showed 46 and were contaminated by my own concurrent suites. `tsc -p tsconfig.build.json --noEmit` clean.
- [x] 4.2 front `npm run typecheck` (**not** bare `npx vue-tsc --noEmit`) and `npx vitest run`.
      → 854 passed (96 files), `vue-tsc -b` clean. Needed a fix first: `docConfig.spec.ts` asserted that a step with no approver parses — the same permissiveness the backend fixtures encoded. Updated, and a test added for the refusal.
- [x] 4.3 `openspec validate --all`.
      → 72 passed / 0 failed.
- [x] 4.4 By hand on the running app: configure a step with no approver and confirm the save is
      refused; submit a document into a workflow with a band gap and confirm it stays `DRAFT` with
      no reservation, where today it strands `SUBMITTED` holding budget.
      → On the running app. A step naming nobody → **400** "Step 91 names no approver…"; the same step naming a role → **201**. A document into a workflow with a band gap → **400** "No approval step applies to this document…", left `DRAFT` with 0 `budget_txn` rows and 0 route rows. The probe workflow, type and document were removed afterwards; they were scaffolding, not evidence.

## 5. Scope deliberately left out

- [x] 5.1 **Escalation coherence** — an escalation target on a step with no `sla_hours`, or on a
      `PARALLEL_ALL` step, stays storable. Both are inert rather than harmful, `SLA and Escalation`
      already specifies the behaviour for a `PARALLEL_ALL` step *"whatever it names"*, and refusing
      the write would break naming a target before enabling the SLA (D2). A hint on the
      configuration screen would serve better and belongs to that screen.
      → Held — escalation settings stay storable.
- [x] 5.2 **The other configuration surfaces found in the same sweep** — `document_type`
      (`requires_payee` without a vendor, a stock post-action without `requires_warehouse`,
      `accrues_on_approval` with no budget) and `document_type_ref` (`auto_create` on a predecessor
      that never creates successors, `successor_department` without `auto_create`). Same class,
      different modules, their own changes.
      → Held — `document_type` and `document_type_ref` untouched; they are the next two changes.
- [x] 5.3 **MikroORM `ValidationError` answering 500 rather than 400** — two known instances now
      (`PUT /documents/:id/lines` without `lineAmount`, and a stock post-action with no warehouse).
      A fault-handling question, not a configuration one.
      → Held — the 500/400 escape is untouched.
- [x] 5.4 **Stored workflows are not retro-validated.** The step rule binds on write; the submit
      gate covers whatever is already out there, which is the stronger half of this change and the
      reason not retro-validating is acceptable.
      → Held — no stored workflow was re-validated.
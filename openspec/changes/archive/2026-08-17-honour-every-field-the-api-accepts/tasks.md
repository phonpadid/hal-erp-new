## 1. Schema and entities

- [x] 1.1 One migration for both schema changes: drop `workflow.condition_json`, and re-state
      `approval_log_action_check` over `('APPROVE','REJECT','RETURN','ESCALATE')` — the constraint
      was last written by `Migration20260629000000`. Nothing has launched, so the column is dropped
      rather than deprecated (design D4, D5).
- [x] 1.2 DBML: remove `condition_json` from `Table workflow`, and `DELEGATE` from
      `Enum approve_action`. The note on `workflow` states that selection is by `dept_doc_type`
      alone, so the next reader does not re-add the column.
- [x] 1.3 Entities: drop `Workflow.conditionJson`; drop `ApproveAction.DELEGATE`. The build will
      name every remaining reference — that list is the rest of the work in sections 3 and 4.

## 2. The company boundary on step configuration

- [x] 2.1 `addStep` resolves the workflow with a query scoped to the active company and refuses
      another company's as not-found — never `getReference` on a DTO-supplied id (design D1,
      invariant 1).
- [x] 2.2 `addStep` and `updateStep` resolve `approver_role_id` against the active company's `role`
      rows and `approver_user_id` against the users holding a role in the active company
      (`user_company_role` — the same relation `ApproverResolverService.principals` reads), and
      refuse a target from another company with a 400 naming the field. `updateStep` has this hole
      too; fix both in the same pass.
- [x] 2.3 `addStep` calls `assertNoInFlight`, like `updateStep` and `deleteStep`. Note in the code
      that the guard is removed wholesale by `lock-the-route-at-submit` — it is enforced here
      because the hazard is live until then (design D2).
- [x] 2.4 `addStep` performs resolution, guards and write inside one `em.transactional(...)`, the
      shape its two siblings already use. This change writes no `budget_txn` and no `quota_usage`
      and touches no path that does, so there is no reserve/release sequence and no
      `PESSIMISTIC_WRITE` to place (design D6).
- [x] 2.5 The guard's residual race — a document submitted between the count and the commit — is
      accepted and stated in a comment, with the reason it is not worth a lock: the rule itself is
      about to be deleted (design D6).

## 3. The action endpoint

- [x] 3.1 `ActDto.action` narrows to a `HumanAction` union — `APPROVE | REJECT | RETURN` — validated
      so `ESCALATE` is refused at validation, before `act()` is entered and before any
      `approval_log` row exists.
- [x] 3.2 `act()`'s switch becomes exhaustive over that union with an `assertNever` default, so a
      value added later cannot fall through into a history row (design D3).
- [x] 3.3 Leave the `persist`/`flush` ordering in `act()` alone — the log row must be visible to
      `stepComplete` before it counts approvals. The two layers above close the hole without
      touching routing (design D3).
- [x] 3.4 `ESCALATE` stays in `ApproveAction` and stays written by `SlaService` alone.

## 4. Removing what does nothing

- [x] 4.1 Delete the `DELEGATE` branch from `act()`. Delegation as a capability
      (`approval_delegation`, the resolver's one-hop lookup) is untouched.
- [x] 4.2 Remove `conditionJson` from `CreateWorkflowDto` / `UpdateWorkflowDto` and from
      `WorkflowConfigService` — `createWorkflow`, the list projection, and `updateWorkflow`.
- [x] 4.4 `external-api`'s `API Keys Cannot Approve` enumerated "approve, reject, or delegate" and
      "an approve, reject, or delegate endpoint" — a verb and an endpoint that no longer exist.
      Carried as a MODIFIED delta so the sync applies it, not hand-edited into `openspec/specs/**`.
- [x] 4.3 Grep `back/src` for `DELEGATE` and for `workflow` + `conditionJson` afterwards: what
      remains must be the step-level condition, which routing reads.

## 5. Frontend

- [x] 5.1 Remove the workflow-level selection-condition inputs from the workflow create/edit form
      and its Zod schema, and the condition summary from the Workflows list and the detail view.
- [x] 5.2 The step editor's approver pickers offer the active company's own roles and members.
- [x] 5.3 Remove the `DELEGATE` history label from the three locales; keep `ESCALATE`, which the
      sweep still writes.
- [x] 5.4 `ApprovalAction` in the api client already reads `'APPROVE' | 'REJECT' | 'RETURN'` —
      confirm nothing sends anything else, and that a 400 from the narrowed DTO surfaces through
      the existing error path.

## 6. Tests

- [x] 6.1 A step cannot be added to another company's workflow: refused as not-found, and no
      `workflow_step` row is written.
- [x] 6.2 A step cannot be created or updated naming a role or a user from another company: refused
      with the field named, and the step is unchanged. Two tests, one per operation — `updateStep`
      is the one that looks safe.
- [x] 6.3 Adding a step is refused while the workflow has a `SUBMITTED` or `IN_APPROVAL` document,
      with the same shape as the existing edit/delete cases.
- [x] 6.4 `POST /documents/:id/actions` with `ESCALATE` is refused at validation, and
      `approval_log` gains no row — assert the row count, not just the status code.
- [x] 6.5 Approve / reject / return are unchanged: same transitions, same hold releases, same
      signature stamping.
- [x] 6.6 A workflow round-trips without a selection condition: create, read, update, and nothing
      in the payload carries one.
- [x] 6.7 Each new test must fail with its fix removed. Check it.

## 7. Checks

- [x] 7.1 `npm test` in `back/`, `nest build`, frontend `test` + `typecheck`; `PIPESTATUS`.
      back: 1499 passed (+17 from this change), 1 failed — `attendance-period.service.spec.ts`
      "rejects a correction into a closed period", the pre-existing time bomb that pins `2026-07-15`
      against a 30-day correction window. Attendance is untouched here. `nest build` clean;
      front-end 807 tests and `vue-tsc` clean.
- [x] 7.2 The migration drops one column and restates one check constraint — nothing else. Schema
      and DBML agree. `Migration20260826000000` is exactly those two statements; the DBML change is
      `workflow.condition_json` and the `DELEGATE` enum member, nothing more.
- [x] 7.3 `openspec validate --all` passes. This change validates ✓. The run reports three failures,
      all of them the sibling proposals (`lock-the-route-at-submit`,
      `escalate-to-someone-not-past-them`, `say-who-withdrew-the-document`) which carry a
      `proposal.md` and no deltas yet — expected until each is taken through `/opsx:propose`.
- [x] 7.4 Do NOT edit `openspec/specs/**` by hand. The working tree's changes there are the previous
      change's archive sync, untouched by this one.

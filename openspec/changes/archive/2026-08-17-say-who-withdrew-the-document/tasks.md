## 1. Schema and entities

- [x] 1.1 Migration: restate `approval_log_action_check` over
      `('APPROVE','REJECT','RETURN','ESCALATE','CANCEL')`. The constraint was last written by the
      migration that removed `DELEGATE`; this is the same shape one change later.
- [x] 1.2 DBML: add `CANCEL` to `Enum approve_action` with a note that it is the requester's own
      withdrawal, distinct from an approver's REJECT.
- [x] 1.3 `ApproveAction.CANCEL` in the enum. It is NOT added to `HUMAN_ACTIONS`: the approval
      endpoint takes approve/reject/return, and a withdrawal arrives at
      `POST /documents/:id/cancel` under `DOC_CANCEL`, not at the approval endpoint under
      `DOC_APPROVE`.

## 2. The act

- [x] 2.1 `CancelDocumentDto` with an optional `remark`, validated like every other DTO; the
      controller accepts a body on `POST /documents/:id/cancel` and passes it through (design D4).
- [x] 2.2 `cancel()` wraps its guards, the `approval_log` row and the status transition in one
      `inTransaction(...)`, mirroring `act()`. `releaseDocumentHolds` stays after the commit, where
      reject already calls it, and remains idempotent (design D3).
- [x] 2.3 The row carries actor, `step_no` = `document.current_step_no` (`0` for a draft), the
      remark, `acted_at`, and no signature (design D1, D2).
- [x] 2.4 The early return on an already-`CANCELLED` document stays, and now also guarantees one row
      and one notification per withdrawal (design D6).
- [x] 2.5 This change writes no `budget_txn` and no `quota_usage` of its own — the existing release
      path writes those, unchanged, in its own transaction (invariant 4, 5). No new lock: nothing
      here reserves budget or issues a number.

## 3. Telling the people who were holding it

- [x] 3.1 `cancel()` emits `document.cancelled` after the commit with `{ documentId, requesterId,
      stepNo }`.
- [x] 3.2 The approvers are resolved by the LISTENER, not the emitter: `DocumentSubmitService`
      cannot reach `ApproverResolverService` without a module cycle, and the notification module
      already depends on that resolver (`notification.scheduler.ts`) — design D5.
- [x] 3.3 `NotificationEventsListener` gains an `@OnEvent('document.cancelled')` handler beside the
      existing `approval.step-assigned` / `approval.outcome` ones; it loads the step the document
      was on, resolves the eligible actors, and notifies them that it was withdrawn and by whom.
- [x] 3.4 A withdrawal at step `0` (a draft) notifies nobody.
- [x] 3.5 A notification failure must not roll back the withdrawal — the listener runs after commit
      and its failure is contained.

## 4. Frontend

- [x] 4.1 The cancel confirmation lets the user type a reason and sends it as `remark`; empty is
      accepted and sends no remark.
- [x] 4.2 The confirmation for a `SUBMITTED` / `IN_APPROVAL` document says it is currently with
      approvers; a draft keeps the plain prompt.
- [x] 4.3 `CANCEL` gets its label in the three locales and its icon/severity in the timeline maps
      (`ACTION_ICON`, `ACTION_SEVERITY`) — an unrecognised action renders as a blank line
      (design D7).

## 5. Tests

- [x] 5.1 Withdrawing an `IN_APPROVAL` document writes exactly one `CANCEL` row with the actor, the
      step it was on, and the remark; the document is `CANCELLED`.
- [x] 5.2 A withdrawn draft is recorded at `step_no` 0.
- [x] 5.3 The remark is optional — the row is written with a null remark.
- [x] 5.4 No signature is stamped on the row.
- [x] 5.5 Withdrawing twice leaves exactly one row, and the second call still succeeds.
- [x] 5.6 Holds are still released on withdrawal — covered by `document-engine.service.spec.ts`
      "cancel releases all budget holds", which submits, withdraws and asserts the outstanding
      reserve is zero. It sits in the same file as the new withdrawal cases and passed unchanged
      after the transaction was restructured around it.
- [x] 5.7 The pending approvers are notified, and a draft's withdrawal notifies nobody.
- [x] 5.8 Only the creator may withdraw, and only from `DRAFT` / `SUBMITTED` / `IN_APPROVAL` — the
      existing guards, re-asserted after the transaction change.
- [x] 5.9 Each new test must fail with its feature removed. Check it.

## 5b. Found at archive: the table gained a second writer

- [x] 5b.1 `approval-workflow`'s `Authorized, Append-Only Actions with Hold Release` opened with
      "Every approval action SHALL require `DOC_APPROVE`, be recorded in the append-only
      `approval_log`" — after this change a row in that table is written under `DOC_CANCEL`, so the
      sentence was false about its own table. MODIFIED to scope `DOC_APPROVE` to the approval
      endpoint and to say which permission authorises a withdrawal.
- [x] 5b.2 `CANCEL` is refused at the approval endpoint (it is not an approval decision and does not
      arrive there) — asserted in `act-dto-validation.spec.ts`.
- [x] 5b.3 `POST /documents/:id/cancel` carries no `ApiKeyDenyGuard`, so an API key can now write to
      `approval_log` by withdrawing the request it raised. Kept deliberately: a key that can create
      and submit a request must be able to end it. `external-api`'s `API Keys Cannot Approve` says
      so explicitly rather than leaving it to be discovered.
- [x] 5b.4 A test pins WHERE the channel cap is mounted (`api-key-guards.spec.ts`): denied on the
      approval endpoints, absent on withdrawal. Removing the guard from `act` fails it.

## 6. Checks

- [x] 6.1 `npm test` in `back/`, `nest build`, frontend `test` + `typecheck`; `PIPESTATUS`.
      back: 1510 passed (+11 from this change), 1 failed — `attendance-period.service.spec.ts:562`,
      the pre-existing time bomb that pins `2026-07-15` against a 30-day correction window.
      Attendance is untouched here. `nest build` clean; front-end 807 tests and `vue-tsc` clean.
- [x] 6.2 The migration restates one check constraint — nothing else. `Migration20260827000000` is
      exactly that; the DBML change is the `CANCEL` enum member and its note.
- [x] 6.3 `openspec validate --all` passes. This change validates ✓; the run's 2 failures are the
      sibling proposals (`lock-the-route-at-submit`, `escalate-to-someone-not-past-them`) which
      carry a `proposal.md` and no deltas yet.
- [x] 6.4 Do NOT edit `openspec/specs/**` by hand. The 13 changed files there are the two prior
      archive syncs, untouched by this change.

## Why

`approval-workflow` requires that a post-action which ultimately fails SHALL roll back the
terminal transition, leaving the document "not stuck (still routable), never half-applied".
`CREATE_SUCCESSOR` does not honour that. Unlike every other post-action — which runs inside the
approval transaction under a bounded retry, so a persistent failure rolls the whole approval back
— successor creation runs **after commit** and swallows every error into a log line
(`post-action.service.ts:107-109`). A `PROC` therefore reaches `COMPLETED` with no `PO`, which is
exactly the half-applied state the spec forbids, and nothing outside the server log says so.

On the `PROC → PO → DISB` path this is the quiet failure that matters most: no PO means no
disbursement, which means a payable that never reaches finance. Nobody is notified, no state is
wrong enough to notice, and the requester believes the document is done — because it says it is.

## What Changes

- **New `pending_successor` table** — an outbox. On full approval of a `CREATE_SUCCESSOR`
  document the system records the *intent* to create each configured successor, **inside the
  approval transaction**, so the intent commits atomically with the terminal transition. The
  intent cannot be lost, and the document is no longer half-applied: the successor is owed and
  the system knows it.
- **New sweep worker** creates the owed successors outside the approval transaction, following
  the existing `NotificationScheduler` pattern (`@Interval` + separately unit-testable scan). It
  attempts each pending row, marks it `DONE` on success, and records the error and an attempt
  count on failure.
- **Bounded retry, then a visible dead state.** A row that keeps failing lands in `FAILED` rather
  than retrying forever. `FAILED` is queryable, so the condition is reportable instead of being a
  log line nobody reads.
- **`CREATE_SUCCESSOR` becomes an ordinary post-action** — the special-case early return at
  `post-action.service.ts:52` and the post-commit call at `approval-routing.service.ts:284` both
  go away. The action writes its outbox rows and returns like every other action.
- **The successor's identity becomes explicit configuration instead of an accident of who was
  logged in.** Running post-commit inside the approving user's request means the auto-created
  successor today inherits the **approver's** department and `created_by`. A sweep has no request
  to inherit from, which forces the question — and neither answer was ever designed:
  - **New `document_type_ref.successor_department_id`** (nullable). Null keeps the successor in
    the source document's department (right for same-department chains like
    `ADVANCE → CLEAR_ADVANCE`); set, it lands the successor in the department that owns it —
    `PROC → PO` into Procurement, matching how procurement actually works: the requesting
    department asks, the buying department buys. The department is a property of the configured
    chain (invariant 7), not of whoever happened to sign last.
  - **`created_by` becomes the source document's requester**, always. The successor exists
    because that person asked for it. **BREAKING** vs today, and a fix: today's value collides
    with invariant 8 — the last approver of a `PROC` silently becomes unable to approve the `PO`,
    which nobody designed and nothing documents.
- Successor creation stays **out** of the approval transaction, so a misconfiguration (an
  inactive successor type, a numbering clash) still cannot block six approvers' work. The
  difference is that the failure is now durable and visible instead of dropped.
- **No new approval semantics.** Approving still completes the document; nothing about routing,
  budget, or quota changes.

## Capabilities

### New Capabilities
- `successor-outbox`: the `pending_successor` outbox, the sweep that drains it, retry bounds, and
  the terminal `FAILED` state.

### Modified Capabilities
- `approval-workflow`: `CREATE_SUCCESSOR` SHALL record its intent inside the approval transaction
  rather than best-effort after commit; the post-action requirement's rollback rule is restated so
  the deferred-but-guaranteed path is explicitly conformant rather than a silent exception to it.
- `document-engine`: the `CREATE_SUCCESSOR` auto-create requirement SHALL be satisfied by the
  outbox — the successor is created promptly after approval rather than synchronously within it,
  and creation is guaranteed rather than best-effort. `document_type_ref` gains
  `successor_department_id`, so a pairing configures which department the successor lands in.
- `web-doc-config`: the ref-chain editor SHALL let a `DOC_CONFIG_MANAGE` user set the successor
  department per pairing, alongside the existing `auto_create` flag.

## Impact

**Invariants.** No `budget_txn` or `quota_usage` row is written by this change. The outbox insert
joins an existing transaction that already writes `approval_log` — an append-only ledger — so the
insert must not disturb it; the outbox itself is *not* append-only (rows move `PENDING → DONE` /
`FAILED`), which is why it is a work queue and not a ledger, and why it lives in its own table
rather than as a column on `document`. Invariant 7 holds: what gets created is still read from
`document_type_ref`, and the sweep branches on no document type.

**Company isolation.** `pending_successor` is company-scoped; the sweep runs across companies as
a system actor, like `NotificationScheduler`, and every `createFrom` it performs stays within the
source document's own company. No inter-company successor is possible.

**Behaviour change.** The successor appears seconds-to-a-sweep after approval instead of
immediately. Any test or client that reads the successor straight after approving must tolerate
that gap. This is the change's real cost and is called out in design.

**Schema.** 1 new table plus a nullable `document_type_ref.successor_department_id`;
`erp_approval_system.dbml` must be updated.

**Why the department is configured rather than inherited.** `DeptDocTypeService.resolve` rejects a
(department, type) pair that has no active mapping, so "inherit the requester's department" is not
a safe default: a `PROC` raised by IT would owe a `PO` that IT cannot create, and every such
obligation would land in `FAILED` — the same silent non-delivery this change exists to end. The
seed hides this by mapping every type to the single `PROC` department, so any inheritance rule
looks correct there and only diverges in a real multi-department deployment.

**Code.** `back/src/modules/approval/post-action.service.ts` (drop the special case, write the
outbox), `approval-routing.service.ts` (drop the post-commit call), a new sweeper beside
`notification.scheduler.ts`'s pattern, `back/src/modules/document/document.service.ts`
(`createFrom` is reused unchanged).

**Out of scope.** A manual "retry this failed successor" endpoint and any UI for the failed
queue — the sweep and its `FAILED` state come first; surfacing them is a follow-up. The other two
known gaps found alongside this one are also out of scope: the hardcoded 3-way match tolerance
(`matching.service.ts:10`) is a missing config, not a defect, and `SEQUENTIAL`/`PARALLEL_ANY`
behaving identically is what `approval-workflow` already specifies.

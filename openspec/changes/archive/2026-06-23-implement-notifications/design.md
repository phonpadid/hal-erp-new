## Context

The scaffold provides `notification_template` (global) and `notification` (company-scoped).
approval-workflow exports `SlaService` (`stepDueAt`) and `ApproverResolverService` (who's
eligible on a step). The env carries `MAIL_*` (Gmail SMTP) and `REDIS_*`. No schema change.

## Goals / Non-Goals

**Goals**
- Template CRUD + `{var}` rendering.
- `dispatch` that creates a `notification` row and sends via the channel transport, with
  PENDING→SENT/FAILED status.
- IN_APP + EMAIL (nodemailer) transports; LINE/SMS no-op.
- Caller-scoped retrieval (+ unread filter) and `markRead`.
- Event-driven generation (step-assigned, outcome) + an SLA-overdue scan.
- Deliver the SLA escalation trigger deferred from approval-workflow.

**Non-Goals**
- LINE/SMS integrations, WebSocket push, a durable retry/outbox queue.
- Changing approval routing logic (only an optional event emission is added).

## Decisions

### D1 — Transport interface; IN_APP + EMAIL
`interface NotificationTransport { channel: string; send(n: Notification): Promise<void> }`.
- `InAppTransport`: no external send — the persisted row *is* the delivery.
- `EmailTransport`: nodemailer over `MAIL_*`. When `MAIL_USER` is unset (dev/test/CI) it
  no-ops (resolves) so suites stay green without SMTP; configured envs actually send.
- LINE/SMS: a `NoopTransport` records but doesn't deliver.
`NotificationService` picks the transport by channel; unknown channel → no-op.

### D2 — Dispatch lifecycle
`dispatch({ userId, companyId, channel, templateCode?, documentId?, vars?, title?, message? })`:
1. If `templateCode`, load the template and render subject/body from `vars`; else use the
   literal `title`/`message`. Channel defaults from the template.
2. Create the `notification` row (`status = PENDING`, company-scoped, `created_at`).
3. `await transport.send(row)`; on success set `SENT` + `sent_at`, on throw set `FAILED`.
4. Flush. Return the row. (Each dispatch is independent; one failure never blocks others.)

### D3 — Rendering
`render(template, vars)` replaces every `{key}` in `subject_template` / `body_template`
with `vars[key]` (missing keys → empty string). Pure string substitution — no template
engine. Variables include `doc_no`, `requester_name`, etc., supplied by the caller/event.

### D4 — Retrieval & read tracking
`listForUser(userId, { unreadOnly? })` via the company-scoped EM (active company),
ordered by `created_at desc`. `markRead(id, userId)` loads the row, asserts ownership, sets
`is_read` + `read_at`. Notifications are company-scoped (`CompanyScopedEntity`).

### D5 — Event-driven generation, decoupled
Use `@nestjs/event-emitter`. approval-workflow's `ApprovalRoutingService` gets an
**optional** `EventEmitter2` (constructor `@Optional()`); when present it emits
`approval.step-assigned` ({ documentId, stepNo, approverUserIds }) on `start`/advance and
`approval.outcome` ({ documentId, status, requesterId }) on terminal/reject/return. A
`NotificationEventsListener` (`@OnEvent`) calls `NotificationService` helpers
(`notifyApprovalPending`, `notifyOutcome`). Optionality keeps the existing approval unit
tests (which construct the service with 4 args) working unchanged; the Nest app wires the
emitter globally.

### D6 — SLA scan + scheduler
`NotificationScheduler.scanOverdue(now?)`: find `IN_APPROVAL` documents, compute the
current step's due time via `SlaService.stepDueAt(submittedAt, slaHours, companyId)`, and
for those past due dispatch an overdue notification to the step's eligible approvers (via
`ApproverResolverService`). A `@Cron`/`@Interval` wrapper calls `scanOverdue` periodically;
the scan method itself is unit-tested (the cron wrapper is not). `ScheduleModule.forRoot()`
is registered in `AppModule`.

### D7 — Helpers used by listener + scheduler
`notifyApprovalPending(documentId, approverUserIds, { overdue? })` and
`notifyOutcome(documentId, status)` resolve the document (company, requester, doc_no),
build vars, and call `dispatch` per recipient with the appropriate template code
(`DOC_PENDING_APPROVAL`, `SLA_OVERDUE`, `DOC_APPROVED`, `DOC_REJECTED`) defaulting to an
IN_APP literal message when the template is absent.

## Risks / Trade-offs

- **EMAIL no-op without SMTP** could mask misconfiguration → it logs a warning and the row
  is still `SENT` (the app-level intent succeeded); a stricter mode can fail instead. Tests
  cover IN_APP (deterministic) and the FAILED path via an injected throwing transport.
- **Optional emitter in approval** is slightly implicit → documented; the alternative
  (hard dependency) would have forced rewrites of the approval test setup.
- **SLA scan cost** (scan all IN_APPROVAL each tick) → fine at this scale; a due-time index
  or per-step timer can come later. The cron interval is conservative.
- **Company scope on notifications** with a system scheduler that has no active company →
  the scan queries with the filter disabled and dispatches per the document's company.

## Migration Plan

No DB migration. Steps: add `nodemailer` + `@nestjs/event-emitter` + `@nestjs/schedule`;
build `NotificationsModule` (service, transports, listener, scheduler, controller, DTOs,
permission constants); register it + `EventEmitterModule.forRoot()` +
`ScheduleModule.forRoot()` in `AppModule`; add the optional emitter to
`ApprovalRoutingService`; add tests; `pnpm build` + `pnpm test`. Rollback = revert the
module + the optional emission.

## Open Questions

- Should a failed EMAIL fall back to IN_APP automatically? Default: no — record `FAILED`;
  a resend/fallback policy can be added with the retry queue.
- Seed default templates (DOC_PENDING_APPROVAL, etc.) as data? Default: provide the codes
  and render literals when a template row is absent, so the system works before templates
  are configured; seeding is an ops concern.

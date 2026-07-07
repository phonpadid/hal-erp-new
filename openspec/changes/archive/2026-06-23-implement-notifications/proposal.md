## Why

`notifications` closes the build order: template-driven, multi-channel messages with
delivery + read tracking, reacting to approval events (step assignment, approve / reject /
return) and SLA-overdue steps. It is also the home for the **SLA escalation scheduler**
deferred from approval-workflow. The scaffold ships `notification_template` and
`notification`; this change makes them dispatch.

## What Changes

- **`NotificationsModule`** registering the two entities, with services + a controller.
- **Templates** (`NOTIFICATION_MANAGE`): CRUD for `notification_template` per channel
  (EMAIL / IN_APP / LINE / SMS) with `{placeholder}` variables, and a renderer that
  substitutes variables into subject/body.
- **Dispatch** (`NotificationService.dispatch`): render the template (or use a literal
  title/message), create a `notification` row (`PENDING`), send it through the channel's
  transport, and mark `SENT` + `sent_at` on success or `FAILED` on error. Transports:
  **IN_APP** (the row is the delivery) and **EMAIL** (nodemailer via `MAIL_*`; a no-op when
  SMTP isn't configured so non-prod stays green). LINE / SMS are recognized but no-op for
  now.
- **Read tracking & retrieval**: list the caller's own notifications (with an unread
  filter), and `markRead` setting `is_read` + `read_at`. Company-scoped.
- **Event-driven hooks**: approval-workflow emits domain events
  (`approval.step-assigned`, `approval.outcome`) via `@nestjs/event-emitter`; a listener
  turns them into notifications (e.g. a pending-approval notice to each eligible approver,
  a reject/approve notice to the requester). Emission from approval-workflow is added as an
  **optional** dependency so existing approval tests are unaffected.
- **SLA scheduler**: a `@nestjs/schedule` cron periodically scans `IN_APPROVAL` documents
  whose current step is past its working-hour SLA (`SlaService`) and notifies / escalates —
  the escalation trigger deferred from approval-workflow. The scan method is testable
  independently of the cron.

No schema change — both entities already match the DBML.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `notifications`: adds the concrete dispatch/retrieval/eventing requirements the existing
  two implied but did not pin down — multi-channel dispatch with status transitions,
  read-tracking + caller-scoped retrieval, and event-driven + SLA-scheduled generation. The
  two existing requirements (Notification Templates, Delivery and Read Tracking) are
  unchanged.

## Impact

- **Affected capability**: `notifications` (final node — closes the build order).
- **Invariants exercised**: **1** (company-scoped notifications), **5**
  (`NOTIFICATION_MANAGE` for templates; users read only their own), **7** (channel behavior
  from template config).
- **Code**: new `back/src/modules/notification/` services, transports, listener, scheduler,
  controller, DTOs, module; a small optional event emission added to
  `ApprovalRoutingService`. Registered in `AppModule` (+ `EventEmitterModule.forRoot()` and
  `ScheduleModule.forRoot()`).
- **New dependencies**: `nodemailer` (+ `@types/nodemailer`), `@nestjs/event-emitter`,
  `@nestjs/schedule`.
- **New permission codes**: `NOTIFICATION_VIEW` (own inbox), `NOTIFICATION_MANAGE`
  (templates).

## Out of Scope

- LINE / SMS transport integrations (recognized, no-op) — pluggable later behind the same
  transport interface.
- A durable outbox / retry queue for failed sends (status `FAILED` is recorded; a resend
  job can come later) — uses the configured `REDIS_*` when a queue is introduced.
- Real-time push (WebSocket) for in-app delivery — the row + polling/`GET` suffices now.

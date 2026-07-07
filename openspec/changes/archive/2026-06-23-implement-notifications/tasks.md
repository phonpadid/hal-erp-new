## 1. Dependencies & module scaffolding

- [x] 1.1 Add `nodemailer` (+ `@types/nodemailer`), `@nestjs/event-emitter`, `@nestjs/schedule`; install.
- [x] 1.2 Create `NotificationsModule` (`MikroOrmModule.forFeature([NotificationTemplate, Notification])`; import `MultiCompanyModule` for `WorkingTimeService`/`SlaService` deps and `ApprovalWorkflowModule` for `SlaService` + `ApproverResolverService`; provide `CompanyScopeService`); register it, `EventEmitterModule.forRoot()`, and `ScheduleModule.forRoot()` in `AppModule`.
- [x] 1.3 Add permission-code constants `NOTIFICATION_VIEW`, `NOTIFICATION_MANAGE`; add DTOs (template create/update; dispatch input; list query `unreadOnly?`).

## 2. Templates & rendering

- [x] 2.1 `TemplateService`: CRUD `notification_template` (`NOTIFICATION_MANAGE`); `render(template, vars)` substituting `{key}` in subject/body (missing → empty).

## 3. Transports & dispatch

- [x] 3.1 `NotificationTransport` interface + `InAppTransport` (no external send), `EmailTransport` (nodemailer over `MAIL_*`; no-op when `MAIL_USER` unset), `NoopTransport` (LINE/SMS).
- [x] 3.2 `NotificationService.dispatch(input)`: render (template) or literal; create `notification` row PENDING (company-scoped); send via channel transport; set SENT+`sent_at` or FAILED; return the row.
- [x] 3.3 Helpers `notifyApprovalPending(documentId, approverUserIds, { overdue? })` and `notifyOutcome(documentId, status)`: resolve document vars (doc_no, requester) and dispatch per recipient (template code with IN_APP literal fallback).

## 4. Retrieval & read tracking

- [x] 4.1 `listForUser(userId, { unreadOnly? })` (company-scoped, newest first); `markRead(id, userId)` → `is_read` + `read_at` (ownership checked).
- [x] 4.2 `NotificationController`: `GET /notifications` (own, `unreadOnly` filter), `POST /notifications/:id/read`; template CRUD under `NOTIFICATION_MANAGE`; `JwtAuthGuard` + `PermissionsGuard`, `ParseUUIDPipe`.

## 5. Event-driven generation

- [x] 5.1 Add an **optional** `EventEmitter2` (`@Optional()`) to `ApprovalRoutingService`; emit `approval.step-assigned` ({ documentId, stepNo, approverUserIds }) on start/advance and `approval.outcome` ({ documentId, status, requesterId }) on terminal/reject/return. Existing approval tests (4-arg construction) stay unaffected.
- [x] 5.2 `NotificationEventsListener` (`@OnEvent`): on step-assigned → `notifyApprovalPending`; on outcome → `notifyOutcome`.

## 6. SLA scheduler

- [x] 6.1 `NotificationScheduler.scanOverdue(now?)`: scan `IN_APPROVAL` documents, compute current-step due via `SlaService.stepDueAt`, and `notifyApprovalPending(..., { overdue: true })` for those past due. A `@Interval`/`@Cron` wrapper calls it (wrapper not unit-tested).

## 7. Tests

- [x] 7.1 Rendering: a template with `{doc_no}` / `{requester_name}` renders with the document's values.
- [x] 7.2 IN_APP dispatch: creates a row for the user with `status = SENT` and `sent_at` set; message rendered.
- [x] 7.3 FAILED path: a throwing transport leaves the row `status = FAILED`.
- [x] 7.4 Read tracking: `markRead` sets `is_read` + `read_at`; `listForUser({ unreadOnly })` returns only unread.
- [x] 7.5 Approval pending: `notifyApprovalPending` creates one notification per eligible approver.
- [x] 7.6 SLA scan: an overdue `IN_APPROVAL` document yields an overdue notification; a not-yet-due one does not.

## 8. Verify

- [x] 8.1 `pnpm --filter back build` and `pnpm --filter back test` pass.
- [x] 8.2 Run `openspec validate implement-notifications --strict`.

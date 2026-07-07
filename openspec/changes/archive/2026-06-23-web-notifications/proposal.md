## Why

The approval loop already emits events that land as `notification` rows — an approver gets a
"pending approval" notice on `approval.step-assigned`, a requester gets the outcome on
`approval.outcome`. But there's no UI: recipients have to keep reopening the inbox to notice
anything. A notification bell with an unread badge makes the loop feel live — the approver is
pinged instead of polling. The backend already exposes the own-inbox list and mark-read; this
change adds the Vue surface.

One gap blocks it: the demo seed grants `NOTIFICATION_VIEW` only to `admin`, yet the people who
*receive* notifications are the `approver` and `requester`. So this change also grants
`NOTIFICATION_VIEW` to those seeded roles, so the recipients can actually see their inbox.

## What Changes

- **New capability `web-notifications`** — the notification bell + inbox in the Vue shell.
- **Seed wiring**: grant `NOTIFICATION_VIEW` to the demo `Approver` and `Requester` roles so
  notification recipients can view their own inbox (idempotent re-seed; no schema change).
- **Notification bell** (`NOTIFICATION_VIEW`): a header bell with an unread-count badge that
  refreshes on a light poll and after acting; clicking it opens a dropdown of recent
  notifications.
- **Open a notification**: opening an item marks it read and, when it references a document,
  navigates to that document's detail.
- **Inbox** (`NOTIFICATION_VIEW`): a full list (newest first) with an unread filter, per-item
  mark-read, and a mark-all-read convenience.
- **Shell integration**: a typed `api/notifications.ts` + a small Pinia store exposing the
  list and a derived unread count; the bell is shown only to users holding `NOTIFICATION_VIEW`.
- **Tests**: frontend unit tests for the notifications store (list, derived unread count,
  mark-read updates state); a backend assertion that the seeded `approver` resolves
  `NOTIFICATION_VIEW`.

## Capabilities

### New Capabilities
- `web-notifications`: the Vue notification bell (unread badge + dropdown) and inbox —
  list, open-to-document, mark read, permission-gated.

## Impact

- **Affected**: `front-end/` (new bell + inbox view, store, api, router, AppShell header) and a
  one-line-per-role grant in `back/src/seed/seed-data.ts`.
- **Invariants reflected**: 5 (bell/inbox gated by `NOTIFICATION_VIEW`; the server already
  enforces own-inbox by user id); 1 (notifications are company-scoped and per-user server-side).
- **Consumes**: existing `GET /notifications` (with `unreadOnly`) and
  `POST /notifications/:id/read`. No new endpoint.
- **No backend API or schema change**; no new dependency.

## Out of Scope

- Real-time push (WebSocket/SSE) — the bell polls; live delivery is a later enhancement.
- Email/other-channel delivery UI — the backend transports (in-app/email/noop) stay as-is;
  this surfaces the in-app channel only.
- Notification-template administration UI — `web-notification-admin` (`NOTIFICATION_MANAGE`).
- Per-user notification preferences / mute settings.

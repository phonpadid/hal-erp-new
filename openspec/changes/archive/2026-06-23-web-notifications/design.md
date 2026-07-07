## Context

notifications backend is complete: `NotificationService.listForUser(userId, { unreadOnly })`
and `markRead(id, userId)` (own-inbox enforced), exposed as `GET /notifications?unreadOnly=` and
`POST /notifications/:id/read`, gated by `NOTIFICATION_VIEW`. The approval module already emits
`approval.step-assigned` / `approval.outcome`, and `NotificationEventsListener` turns those into
`notification` rows. A serialized notification carries `subject`, `body`, `isRead`, `createdAt`,
`channel`, and a `document` reference (`{ id }` or null). The Vue shell gives `can()`, the
typed-api/store pattern, and the header in `AppShell`. Gap: the seed grants `NOTIFICATION_VIEW`
only to `admin`, not to the `approver`/`requester` who receive notifications.

## Goals / Non-Goals

**Goals**
- A header bell with an unread badge that refreshes (load + after-act + poll).
- Dropdown of recent notifications + a full inbox; open marks read and jumps to the document.
- Per-item mark-read and a mark-all-read convenience.
- Seed grant so demo recipients can see their inbox.
- Tests: store (list/unread-count/mark-read) + a backend grant assertion.

**Non-Goals**
- Real-time push, email/channel UI, template admin, per-user preferences.

## Decisions

### D1 — Seed grant (make recipients able to view)
Add `NOTIFICATION_VIEW` to the demo `Approver` and `Requester` role grants in `seed-data.ts`
(idempotent `upsert` of `role_permission`). Re-running the seeder grants the code to existing
roles. No spec change — this is within the existing "Bootstrap Seed Data" behavior (roles get
appropriate codes). *Alternative considered:* drop the permission gate so any user sees their
own inbox — rejected; keeps invariant 5 (authorize on codes) and the backend contract intact.

### D2 — Frontend data layer
`api/notifications.ts`: `list(unreadOnly?)` and `markRead(id)`. `stores/notifications.ts`
(Pinia): `items`, `loading`, `error`; getter `unreadCount = items.filter(!isRead).length`;
actions `load()` (full list, newest first — server already orders), `markRead(id)` (calls API
then flips the item's `isRead` locally), `markAllRead()` (loop the unread ids — small N at demo
scale; documented). The `document` link id is read defensively as
`n.document?.id ?? (typeof n.document === 'string' ? n.document : null)`.

### D3 — Bell in the header (poll, not push)
A `NotificationBell.vue` in `AppShell`'s header, shown when `can('NOTIFICATION_VIEW')`: a bell
button with a PrimeVue `Badge`/`OverlayBadge` of `unreadCount`, opening a `Popover` listing the
most recent ~8 items (message + relative time + unread dot). `onMounted` calls `load()` and
starts a `setInterval` poll (every 60s) cleared on `onUnmounted`; `load()` also runs after
`markRead`. No WebSocket (out of scope). Polling at 60s is fine for the demo and cheap.

### D4 — Open behavior
Clicking a notification (in the popover or inbox) calls `store.markRead(id)` then, if it has a
document id, `router.push({ name: 'document-detail', params: { id } })` and closes the popover.
Notifications without a document just mark read (still readable by their text).

### D5 — Inbox view + routing
`views/notifications/NotificationInboxView.vue`: a list/table of all notifications with an
"unread only" toggle, per-row "Mark read", and a "Mark all read" button; rows open like the
popover. Route `notifications` (`meta.permission='NOTIFICATION_VIEW'`); the popover's "View all"
links here. The bell lives in the header (not the main nav), matching common UX.

### D6 — Tests
- Frontend (Vitest): notifications store with a mocked api — `load` populates and orders;
  `unreadCount` reflects unread; `markRead` flips the item and lowers the count; an error is
  captured. A small helper test for the document-id extraction if it grows.
- Backend (DB-backed): extend the seed test (or add one) asserting the seeded `approver`
  resolves `NOTIFICATION_VIEW` (proves D1), reusing `PermissionResolverService` /
  `RbacAuthService` as the existing seed spec does.

## Risks / Trade-offs

- **Polling lag** — up to ~60s before a new notification shows. Acceptable for the demo; swap to
  SSE later without touching the store contract.
- **mark-all-read loops client-side** — O(unread) calls; fine at demo scale, and avoids a new
  backend endpoint. If inboxes grow, add `POST /notifications/read-all`.
- **`document` serialization shape** — read defensively (object `{id}` vs string vs null) so the
  link is robust to MikroORM's reference serialization.

## Migration Plan

Backend: add the two role grants in `seed-data.ts`; re-run the seeder against the dev DB;
`pnpm --filter back build/test`. Frontend: add `api/notifications.ts`, `stores/notifications.ts`,
`NotificationBell.vue` (wired into `AppShell`), `NotificationInboxView.vue`, the route, and
tests; `pnpm --filter front-end build/test`. Validate `openspec validate web-notifications
--type change --strict`. Rollback = revert the seed grants and the `front-end/` additions.

## Open Questions

- Auto-mark-read on popover open, or only on item click? Default: only on click (opening the
  popover to glance shouldn't clear unread).
- Poll interval — 60s default; make it a constant so it's easy to tune or disable in tests.

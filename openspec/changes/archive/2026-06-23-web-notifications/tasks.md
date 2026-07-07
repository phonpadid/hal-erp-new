## 1. Seed: let recipients view their inbox

- [x] 1.1 In `back/src/seed/seed-data.ts`, add `NOTIFICATION_VIEW` to the `Approver` and `Requester` role grants (idempotent `role_permission` upsert).
- [x] 1.2 Backend test (DB-backed): after `seedDatabase`, the seeded `approver` resolves `NOTIFICATION_VIEW` (via `PermissionResolverService` / login grants), and re-seeding stays idempotent.

## 2. Frontend data layer

- [x] 2.1 `api/notifications.ts`: `list(unreadOnly?)` → `GET /notifications` and `markRead(id)` → `POST /notifications/:id/read` (typed; document read defensively as `{id}`/string/null).
- [x] 2.2 `stores/notifications.ts` (Pinia): `items`, `loading`, `error`; getter `unreadCount`; actions `load()` (newest first), `markRead(id)` (flip local `isRead` after API), `markAllRead()` (loop unread ids). Capture server errors.

## 3. Bell + inbox UI

- [x] 3.1 `components/NotificationBell.vue`: header bell with an unread badge (`unreadCount`) and a `Popover` of the most recent items (message + relative time + unread dot); `onMounted` `load()` + a 60s poll cleared on unmount; "View all" → inbox. Shown only when `can('NOTIFICATION_VIEW')`.
- [x] 3.2 Open behavior: clicking an item calls `markRead(id)` then, if it has a document id, routes to `document-detail`; closes the popover.
- [x] 3.3 `views/notifications/NotificationInboxView.vue`: full list with an "unread only" toggle, per-row mark-read, "Mark all read", rows open like the popover; empty + error states.
- [x] 3.4 Wire `NotificationBell` into `AppShell` header (left of the dark-mode toggle); add route `notifications` (`meta.permission='NOTIFICATION_VIEW'`).

## 4. Frontend tests

- [x] 4.1 Notifications store (mock `api`): `load` populates; `unreadCount` reflects unread; `markRead` flips the item and lowers the count; an error is captured.

## 5. Verify

- [x] 5.1 `pnpm --filter back build` + `pnpm --filter back test` and `pnpm --filter front-end build` + `pnpm --filter front-end test` pass.
- [x] 5.2 Run `openspec validate web-notifications --type change --strict`.

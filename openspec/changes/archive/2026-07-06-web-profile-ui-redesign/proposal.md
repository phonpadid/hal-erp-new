## Why

The current "My Profile" page (`/profile`) is a flat three-card grid of key/value
lists. It is functional but visually plain and hard to scan: identity, employee,
roles/permissions, and change-password all read as the same dense text blocks, there
is no visual anchor for "who am I", and empty states (no linked employee, no roles)
are bare one-line sentences. This change reskins the page into a friendlier,
easier-to-read layout with a profile header, clearer sectioning, and supporting
illustrations — without changing what data is shown or how the password change works.

## What Changes

- Add a **profile header (hero) card** at the top: an initials **avatar**, the user's
  display name, position + department, an email-verified badge, and role tags — with a
  decorative illustration on the side (hidden on small screens).
- Restructure the body into cleaner, icon-led sections (**Account**, **Employee**,
  **Roles & Permissions**, **Change password**) with better spacing and hierarchy, so
  each is scannable at a glance instead of a wall of `dt`/`dd` rows.
- Group **permissions by scope** (`OWN`/`DEPARTMENT`/`COMPANY`/`GROUP`) with a count and
  scope-colored tags, replacing the flat list — read-only, as today.
- Add **illustrated empty states** (from the existing `src/assets/illustrations/` set)
  for "no linked employee" and "no roles/permissions", reusing the shared `EmptyState`.
- Give the **change-password** card a supporting illustration and a clearer new-password
  strength/requirements affordance; behavior and validation are unchanged.
- Add the small number of **new i18n keys** (en + la) that the new labels/empty states
  need; no existing copy is hardcoded.
- Presentation only: **no backend, API, DTO, or data-shape change**. The page still reads
  from the existing read-own-profile endpoint and the change-password form still posts to
  the existing endpoint. No new capability, no breaking change.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-user-profile`: the same identity, employee, roles/permissions, and change-password
  requirements now also carry presentation requirements — a profile header with an
  initials avatar, scope-grouped permissions, and illustrated empty states — while all
  behavior (read-only fields, active-company scoping, change-password flow, i18n-only
  copy) is preserved.

## Impact

- **Frontend only.** Rewrites `front-end/src/views/ProfileView.vue`; adds new keys to
  `front-end/src/i18n/locales/{en,la}/profile.ts`; consumes existing assets under
  `front-end/src/assets/illustrations/` and PrimeVue `Avatar`.
- Reuses existing shared components (`PageHeader`, `ErrorState`, `EmptyState`) and the
  `.card` container / PrimeUI theme tokens, so light and dark mode both keep working.
- Updates `front-end/src/views/ProfileView.spec.ts` to cover the new structure; the
  existing data and change-password behavior it asserts is unchanged.
- No change to `src/api/profile.ts`, the backend, or any of the 9 domain capabilities;
  touches no core invariant (read-only display, active-company scoping already enforced
  server-side and preserved).

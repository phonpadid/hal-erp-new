## Context

`front-end/src/views/ProfileView.vue` (≈226 lines) renders `/profile` as three `.card`
blocks in a `lg:grid-cols-2` grid: (1) Account + Employee key/value lists, (2) Roles &
Permissions tags/list, (3) the `@primevue/forms` change-password form. It already fetches
from `profileApi.get()` (`OwnProfile`: `username`, `email`, `emailVerifiedAt`, `status`,
optional `employee{fullName,position,departmentName}`, `roles[]`, `permissions[{code,scope}]`)
and posts to `profileApi.changePassword`. Copy is fully i18n (`locales/{en,la}/profile.ts`).

The redesign is **presentation only**. No API, DTO, store, or backend change; no budget_txn
or quota_usage is written anywhere on this page, so there is no transaction boundary or
locking concern (the ledger/concurrency invariants do not apply to this change). The
constraints that do apply are the frontend conventions: PrimeVue 4 + Aura, Tailwind +
`tailwindcss-primeui` theme tokens (no hardcoded colors, light/dark must both work),
PrimeIcons, and i18n-only copy. The repo already ships an `undraw` illustration set under
`front-end/src/assets/illustrations/`.

## Goals / Non-Goals

**Goals:**
- Make the page scannable: a clear "who am I" header, then well-separated, icon-led sections.
- Add supporting illustrations (header + illustrated empty states) from the existing asset set.
- Group permissions by scope with counts, keeping everything read-only.
- Preserve every existing behavior: read-only identity/employee, active-company scoping,
  the exact change-password flow and validation, and i18n-only copy.
- Keep light/dark correct via theme tokens; keep it accessible (decorative art hidden from AT).

**Non-Goals:**
- No avatar upload, profile editing, or any new write path.
- No backend/API/DTO/store change; `OwnProfile` shape is unchanged.
- No new npm dependency (use PrimeVue `Avatar`, already available).
- No change to the change-password Zod schema or endpoints.

## Decisions

### Layout: full-width header + sectioned body
A full-width **header card** on top, then the detail cards below in a responsive grid
(`grid grid-cols-1 lg:grid-cols-2 gap-6`): left column = Account then Employee; right column
= Roles & Permissions; the change-password form as its own card spanning full width beneath.
Each card keeps the shared `.card` container and a consistent icon-led `h2`. *Alternative:*
keep the flat 3-card grid and only restyle — rejected because the lack of a visual anchor is
the main complaint.

### Avatar from initials (no upload)
Use PrimeVue `<Avatar>` (`shape="circle"`, large) with a `label` of 1–2 **initials** derived
from `employee.fullName` when present, else `username`. Background tone is a deterministic
pick from a small set of PrimeUI token classes, hashed from the username, so it is stable per
user and theme-safe. A tiny helper (`initials(name)`, `avatarClass(seed)`) lives in the view.
*Alternatives considered:* Gravatar/remote image (rejected — external dependency, privacy, and
CSP/asset concerns); a single fixed color (rejected — less identity, more monotonous).

### Illustrations via Vite URL imports, decorative
Import each SVG as a URL (`import headerArt from '@/assets/illustrations/undraw_online-profile_v9c1.svg'`)
and render with `<img :src=".." alt="" aria-hidden="true">` so assistive tech ignores it and
the i18n text carries all meaning. Chosen defaults (all already in the repo):
- Header: `undraw_online-profile_v9c1.svg`
- "No linked employee" empty state: `undraw_user-account_fvqa.svg`
- "No roles / no permissions" empty state: `undraw_checking-boxes_j0im.svg`
- Change-password supporting art: `undraw_all-checked_d3u6.svg`
Header art is wrapped in a `hidden md:block` container and size-capped so it never pushes the
identity text. *Alternative:* inline `<svg>` components — rejected as needless churn; URL
imports keep the assets as-is and cache well.

### Permissions grouped by scope
Reduce `permissions[]` into an ordered map keyed by scope in the fixed order
`OWN → DEPARTMENT → COMPANY → GROUP`; render one subsection per non-empty scope with an i18n
heading, a **count**, and the codes as `Tag`s. Scope labels come from i18n (add
`profile.access.scope.*`). Read-only — no add/remove/edit control, matching the spec.

### Empty states reuse the shared component
Use the existing `EmptyState` component (already used elsewhere, e.g. reports) with the chosen
illustration and the existing/added i18n messages for: no employee, no roles, no permissions.
This keeps empty-state styling consistent app-wide.

### i18n: additive keys only
Add only the new keys the redesign needs — e.g. `profile.header.*` (verified/unverified badge,
role label), `profile.access.scope.{OWN,DEPARTMENT,COMPANY,GROUP}`, and any empty-state
messages not already present — to **both** `en` and `la`. Existing keys are reused as-is; no
copy is hardcoded in the template.

### Tests
Update `ProfileView.spec.ts` to assert the new structure (header shows display name + initials;
permissions render grouped by scope; the no-employee path shows the empty state) while keeping
the existing assertions for the data fields and the change-password success/error flows.

## Risks / Trade-offs

- **Illustration contrast in dark mode** (undraw art is single-accent and can clash) → keep art
  decorative, muted (reduced opacity / neutral container), size-capped, and never load-bearing;
  meaning always lives in theme-token text, so a poorly-contrasting SVG never blocks comprehension.
- **Long permission lists** make the right column tall → group-by-scope with counts shortens the
  visual; if still long, the section scrolls within its card rather than stretching the page.
- **Avatar initials for non-Latin names** (e.g. Lao `full_name`) may not abbreviate cleanly →
  take the first character of the first (and, if present, second) whitespace-separated token and
  fall back to the first character of `username`; never crash on empty/emoji input.
- **Header pushing content on small screens** → the illustration is `hidden md:block`; on mobile
  the header collapses to avatar + text only.
- **Spec/test drift** → `ProfileView.spec.ts` is updated in the same change so the new structure
  is covered and the preserved behaviors stay asserted.

## Migration Plan

Single-file view rewrite plus additive i18n keys and a spec update — no data migration, no
feature flag. Ship in one PR. **Rollback:** revert the `ProfileView.vue`, i18n, and spec commits;
because no API/store/schema changed, reverting the frontend fully restores the previous page.

## Open Questions

- Final illustration choices are defaults above and can be swapped during implementation for
  better on-brand fit (any file already in `src/assets/illustrations/`).
- Whether to also surface the active company name in the header — currently out of scope
  (it lives in the shell); revisit only if it reads as missing context.

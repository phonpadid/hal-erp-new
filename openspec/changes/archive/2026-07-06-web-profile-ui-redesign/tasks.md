# Tasks — web-profile-ui-redesign

> Frontend-only, presentation change. No entities, migration, service, controller, or
> ledger writes are involved, so the backend/concurrency rules do not apply here.

## 1. i18n keys (additive, en + la)

- [x] 1.1 Add `profile.header.*` keys to `front-end/src/i18n/locales/en/profile.ts` (e.g. role
  label, verified / not-verified badge text, and any display-name fallback text)
- [x] 1.2 Add `profile.access.scope.{OWN,DEPARTMENT,COMPANY,GROUP}` labels and any new
  empty-state messages (no employee / no roles / no permissions) to the `en` profile locale
- [x] 1.3 Mirror every new key with a Lao translation in `front-end/src/i18n/locales/la/profile.ts`
  (same key paths; no key left English-only)

## 2. Helpers & assets

- [x] 2.1 Add an `initials(name)` helper in `ProfileView.vue` that takes 1–2 initials from the
  first/second whitespace tokens and safely falls back to the `username` first char
- [x] 2.2 Add an `avatarClass(seed)` helper that maps a hash of the username to one of a small
  set of PrimeUI theme-token color classes (stable per user, works in light + dark)
- [x] 2.3 Import the chosen illustration SVGs as URL imports from `@/assets/illustrations/`
  (header, no-employee, no-roles/permissions, change-password) per design defaults

## 3. Profile header (hero)

- [x] 3.1 Add a full-width header `.card` above the detail grid with a PrimeVue `<Avatar>`
  (circle, large) using `initials()` + `avatarClass()`
- [x] 3.2 Show display name (employee `fullName` else `username`), and — when an employee
  exists — position + department name; show the email-verified badge and role tag(s)
- [x] 3.3 Add the decorative header illustration in a `hidden md:block` container, size-capped,
  with `alt=""` + `aria-hidden="true"`

## 4. Detail sections restructure

- [x] 4.1 Lay out the body as `grid grid-cols-1 lg:grid-cols-2 gap-6`: left = Account then
  Employee cards; right = Roles & Permissions card; change-password card full width below
- [x] 4.2 Restyle the Account and Employee cards with icon-led `h2` headings and clean
  key/value rows (theme tokens only; keep all existing fields and i18n labels)
- [x] 4.3 Keep the Employee section behavior: render fields when linked, else show the
  illustrated empty state (task 5)

## 5. Permissions grouping & empty states

- [x] 5.1 Group `permissions[]` by scope in fixed order `OWN → DEPARTMENT → COMPANY → GROUP`;
  render one subsection per non-empty scope with an i18n heading, a count, and code `Tag`s
- [x] 5.2 Keep Roles & Permissions strictly read-only (no add/remove/edit control)
- [x] 5.3 Render illustrated `EmptyState` for: no linked employee, no roles, no permissions —
  each with its i18n message and a decorative (`aria-hidden`) illustration

## 6. Change-password card

- [x] 6.1 Move the existing `@primevue/forms` change-password form into a restyled card with a
  supporting decorative illustration; do NOT change the Zod resolver, fields, or endpoints
- [x] 6.2 Verify the success / wrong-current-password / server-error messages and the
  form-remount-on-success (fields clear) behavior still work unchanged

## 7. Tests & verification

- [x] 7.1 Update `front-end/src/views/ProfileView.spec.ts`: assert the header shows the display
  name + initials, permissions render grouped by scope, and the no-employee path shows the
  empty state — keeping the existing data-field and change-password assertions
- [x] 7.2 Run `vue-tsc` typecheck and the profile unit test; both pass
- [x] 7.3 Manually verify `/profile` in light and dark mode, and with the Lao locale, that
  layout, illustrations, and all labels render correctly (no hardcoded strings, no color clash)

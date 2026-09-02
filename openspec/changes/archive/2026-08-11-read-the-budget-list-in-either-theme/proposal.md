## Why

The grouped budget list and its group header were built, corrected several times, and verified
entirely in dark mode. Nobody has looked at them in light mode once.

Checking now shows the theme plumbing is sound — every colour is mixed from a PrimeVue token, so
the track flips from white-8% to slate-8% and the figures from white to slate on their own. One
thing does not survive the flip: the fill is `color-mix(… 22%, transparent)`, and 22% of amber over
a light row is close enough to the track that the bar stops reading as a bar. The same 22% is
right in dark. A single opacity cannot serve both.

Two smaller things were deferred out of the previous change on the grounds that they should be
judged after people used the screens, and they have now been asked for:

- The row number keeps counting across group boundaries — 1‥7 under the first control point, then
  8 under the next. A number that runs through a heading it is not part of belongs to a flat list,
  not a grouped one.
- There is no way back to a flat list. Grouping is right for reading a category, but someone
  scanning for one budget by name now has group headers in the way.

## What Changes

- **The fill's strength follows the theme.** The group header's utilisation fill uses a stronger
  mix in light mode than in dark, so the bar reads as a bar in both. The value stays derived from
  the same token, so no colour is hardcoded and no second palette is introduced.
- **Both themes are verified, not assumed.** The screens are checked in light and dark, and the
  contrast between the fill, the track and the row is asserted rather than eyeballed — that is the
  gap this change exists to close, so it must not be closed by looking once.
- **Row numbering restarts within each group.** A grouped list numbers its rows within the group
  the heading introduces.
- **A flat/grouped toggle on the budget list.** Grouped stays the default. The choice persists for
  the session so a user who scans by name is not re-grouped on every visit.
- **The toggle switches presentation only.** Both modes render the same loaded rows and the same
  server-derived figures; flat mode hides the group headers rather than fetching anything
  different.

Deliberately **not** in this change: the control-point screens' own light-mode styling beyond what
the shared components already give them, and any change to grouping rules, amounts, or reads.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-budgets`: the budget list gains a flat/grouped toggle and restarts row numbering inside each
  group; the group header's utilisation fill is required to stay legible in both themes.

## Impact

**Frontend** — `BudgetListView.vue` (toggle, numbering, fill strength), `AppDataTable.vue` (the
row-number column currently counts from the page offset and has no notion of groups), the budgets
Pinia store or a local ref for the persisted toggle, and i18n keys in la/en/zh for the toggle
labels.

**Backend** — none. No read changes shape and no write is involved.

**Permissions** — none. The toggle is presentation, gated by nothing beyond the existing
`BUDGET_VIEW` on the screen.

**Invariants** — none touched. Amounts remain server-derived strings formatted to the base
currency's `decimal_places`; the toggle changes which rows are visible, never what they say.

**Risk** — the light-mode fix is a colour judgement, and the reason this change exists is that a
colour judgement made in one theme did not hold in the other. The mitigation is to assert the
relationship (fill distinguishable from track, figures legible over both) in a test that runs in
both themes, rather than to pick a number that looks right in a screenshot.

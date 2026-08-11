## Context

Measured on the running app, light mode with `.dark` removed from the root:

```
  row background   rgb(241, 245, 249)                       light slate
  track            color(srgb 0.2 0.25 0.33 / 0.08)         slate 8%    ← flipped correctly
  fill             color(srgb 0.92 0.70 0.03 / 0.22)        amber 22%   ← same in both themes
  figures          rgb(51, 65, 85)                          slate       ← flipped correctly
```

The token plumbing works: `color-mix(in srgb, var(--p-text-color) 8%, transparent)` and
`var(--p-text-color)` both flip on their own. Only the fill is a fixed 22% of a fixed hue, and a
hue at 22% over a light row has far less separation than the same 22% over a dark one — amber-500
is a light colour, so it contrasts against dark and blends into light.

The row-number column lives in `AppDataTable.vue` and is computed as
`(page - 1) * rows + index + 1`. It knows nothing about groups, which is correct for every other
caller; the budget list is the first grouped table in the app.

## Goals / Non-Goals

**Goals:**

- The utilisation fill is distinguishable from its track in both themes.
- The figures stay legible over the fill in both themes.
- Row numbers count within the group they sit under.
- A user can drop back to a flat list and stay there for the session.
- The theme question is settled by an assertion that runs in both themes, not by one screenshot.

**Non-Goals:**

- A light-mode pass over the rest of the app, or over the control-point screens beyond what shared
  components already give them.
- Any change to grouping rules, the binding-point choice, amounts, or reads.
- Persisting the toggle across sessions — session scope is enough to stop it being annoying, and
  storing a per-user preference is a different feature with a different home.

## Decisions

### D1 — Vary the mix percentage by theme, not the colour

The fill keeps its hue from `utilColor` and only its strength changes: a higher percentage in
light, the current one in dark. Nothing is hardcoded and there is still exactly one palette.

*Alternatives considered:* a fixed rgba per theme, which reintroduces literal colours the token
system exists to remove; or switching the fill to a solid colour with the figures reversed out of
it, which is more legible but makes the header look like a filled button and pulls more attention
than a category summary should.

The percentage is chosen against the measured row backgrounds rather than by eye, and the
relationship — not the number — is what the spec pins.

### D2 — Read the theme from the same signal the app already uses

`main.ts` configures PrimeVue with `darkModeSelector: '.dark'`, and `useLayout().toggleDarkMode`
sets `layoutConfig.darkTheme` and then toggles that class. The store field is the cause and the
class is its effect, so the component reads the store: it is reactive, so a theme change while the
list is open re-renders the fill, whereas observing the class would need a MutationObserver to
notice at all. Either beats a media query, which would disagree with an explicit user toggle.

### D3 — Restart numbering per group, in the caller

`AppDataTable`'s number column is right for a flat list and is used by many screens. Rather than
teach the shared component about grouping, the budget list supplies its own numbering. That keeps
the change local to the one screen that groups, and leaves every other table untouched.

*Alternative considered:* hide the number column entirely when grouped. The GL code already
identifies a row, so the number carries little — but it is also the only stable left-edge anchor
when scanning, and removing a column people are used to is a bigger change than renumbering it.

### D4 — The toggle is view state, not a query

Flat and grouped render the same loaded rows. Flat mode omits the group headers; it does not
refetch, does not change paging, and does not alter the figures. This keeps the two modes provably
consistent — the same numbers are on screen either way — and means the toggle cannot introduce a
disagreement between what a header claims and what its children show.

The choice lives in the store for the session. It is not written to a user preference: that is a
separate feature with server-side storage and its own permissions, and guessing at it here would
be building the smaller half of something.

## Sequence and locking

This change writes nothing. No `budget_txn` or `quota_usage` row is read for mutation, created or
updated, so no unit of work, transaction boundary or lock is involved. The screens continue to use
the existing company-scoped reads unchanged.

## Risks / Trade-offs

- **A second colour judgement made in one theme.** → The spec asserts the relationship (fill
  distinguishable from track; figures legible over fill) and the test exercises both themes, so the
  next person changing a percentage finds out immediately in the theme they are not looking at.
- **Numbering that restarts can read as "only N budgets" at a glance.** → Accepted: within a
  grouped list the count that matters is the group's, and the total is already on the paginator.
- **A toggle is a small permanent maintenance cost on a screen that is already the most complex in
  the module.** → Contained by D4: flat mode is the grouped data with headers omitted, not a second
  rendering path.
- **Testing colour in jsdom is unreliable** — computed `color-mix` does not resolve there the way it
  does in a browser. → Assert the inputs that decide it (which theme the component read, which mix
  it chose) in the unit test, and confirm the resulting pixels in the browser pass, where
  `getComputedStyle` returns real values.

## Resolved during implementation

- **The toggle stays off the control-points list.** That screen has no grouping to turn off, so a
  control that does nothing would be worse than none. If grouping by department is added there
  later, both screens should put the control in the same place — the budget list's toolbar, beside
  the search.
- **Flat mode has to collapse the header ROW, not just its contents.** PrimeVue still emits one
  row-group header for the single flat bucket. A `v-if` on the header's contents left the `<tr>`
  in place, and with the group tint applied that showed as an empty band above the first budget.
  The row is marked through the `rowGroupHeader` pass-through and hidden by a `:deep` rule — which
  also had to be `:deep`, since scoped CSS does not reach elements a child component renders.

## Open Questions

None outstanding.

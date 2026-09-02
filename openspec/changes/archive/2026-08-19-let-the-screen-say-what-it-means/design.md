# Design — Let the screen say what it means

## Context

Four defects found by driving the create wizard through the seeded types with a mouse. None is a
wrong calculation. Three are the same mistake — the screen offers or shows something that is not
what the system will do — and the fourth is a layout that runs out of room without saying so.

Three are pure client work. The fourth needs one additive field on an existing server read, because
the flag the client must filter on is not currently sent.

## Decisions

### D1. The topbar collapses into the overflow menu it already has

The bar is a single non-wrapping flex row. Measured on the running app:

| part | width |
| --- | --- |
| company selector | 154px |
| notification bell | 35px |
| language buttons (ລາວ / English / 中文) | **185px** |
| theme toggle | 35px |
| palette | 35px |
| gaps | 64px |
| **group total** | **~500px** |

With the brand and the bar's own 56px of padding, the row needs roughly 700px. Below that it clips:
at 482px, 122px of it is beyond the right edge.

There are three ways to give it room:

| | what it costs |
| --- | --- |
| let the row wrap onto a second line | the bar's height changes with the viewport, and a fixed-height bar with `position: fixed` is what the whole layout offsets against |
| shrink every control | the language buttons are already the smallest they read at, and shrinking the company selector hides the company name — the one thing the bar exists to state |
| **fold the optional controls into the ellipsis menu (chosen)** | one more breakpoint, using a mechanism the bar already has |

The bar **already** collapses at 991px: the logout button moves behind an ellipsis. That mechanism is
right and simply does not cover enough. So the group beside it folds in the same way at a lower
breakpoint.

**What folds and what stays is decided by whether the control states a fact about the document the
user is about to create.** The company selector says which company they are working in; the
notification bell says something needs attention. Those stay at every width. Language, theme and
palette are preferences — set once, rarely changed, and the natural residents of an overflow menu.

Two breakpoints, chosen from the measurements rather than picked round:

- **≤767px** — language, theme and palette move into the ellipsis menu. Leaves the selector, the
  bell and the ellipsis, about 205px, which fits comfortably.
- **≤479px** — the brand wordmark is hidden, keeping the logo image, and the company selector stops
  being a fixed `w-44`. At 375px the row is then about 330px of content in 375px of space.

**The brand never wraps.** `HA` / `ER` is not a smaller brand, it is a broken one.

### D2. A screen's own action outranks a global affordance

Two things claim the bottom-right corner: the wizard's sticky action bar (**Next**,
**Save & submit**) and the floating WhatsApp dial, which is `position: fixed` at `bottom/right:
1rem`. The dial wins today by being fixed, which is the wrong way round — the dial belongs to no
screen in particular, and the button underneath it is the entire purpose of the one the user is on.

Two separate faults, two separate fixes:

**It renders before sign-in** because `App.vue` mounts it as a sibling of `<router-view>`, so it is
outside every route including the login form. It moves inside the authenticated layout. A visitor
who has not signed in is not someone to offer a support channel to, and the login screen should
have nothing on it but the login form.

**It covers the primary action** because both are pinned to the same corner and the dial paints
later. The rule adopted is the general one, not a nudge for this one screen: **a page-level sticky
action area paints above a global floating affordance.** Moving the dial to another corner would
only pick a different screen to collide with later; making the rule about precedence keeps it true
for screens not yet written.

This also means the wizard's action bar needs an opaque background. It is currently
`bg-surface-0/90` with a backdrop blur, so anything beneath it shows through faintly — including a
dial that is supposed to be behind it.

### D3. The review step shows what the wizard collected, not a fixed list

The review header renders three tiles — type, currency, vendor — as literal markup. Every other
document-level value the wizard collects is absent: warehouse, destination warehouse, employee,
payee. Both of the values added by the previous change are among the missing, which is how they got
missed: the review step was not part of the change that introduced them, and nothing ties the two
together.

So the rule is stated as a relationship rather than as a longer list: **if the wizard asked for a
value, the review shows it.** The same `document_type` flags that decide whether an input appears —
`requires_warehouse`, `requires_employee`, `requires_vendor`, `requires_payee`, and `post_action` for
the transfer's destination — decide whether its tile appears. A future flag that adds an input gets
its tile from the same place, instead of being forgotten the same way.

The review already marks a *missing* required value. This is the same completeness applied to values
that are present, which is the more common case and the one that actually gets submitted.

### D4. The item filter needs the flag to be sent first

`web-inventory` already requires it: *"The line editor SHALL offer only items whose
`is_stock_tracked` is true."* This change builds an existing requirement rather than adding one, so
there is no spec delta for that capability.

It cannot be built on the client alone. `GET /items/enabled` returns:

```
{ id, itemCode, name, category, defaultUnit, isActive, defaultGlAccount }
```

`is_stock_tracked` is on the `item` entity and is not in that payload, so there is nothing to filter
on. The read gains the field. That is additive — no existing caller reads a field that changes, no
permission moves, and no refusal changes. The alternative, a separate stock-tracked-items endpoint,
would be a second read of the same rows differing by one boolean.

**Which types filter is read from configuration, not from a list of codes** (invariant 7). A type
whose `post_action` is `ISSUE_STOCK`, `ADJUST_STOCK` or `TRANSFER_STOCK` moves stock; those filter.
Every other type keeps the full list, because a purchase requisition may legitimately name a service.

## Risks

- **A breakpoint tuned to today's controls.** The 767px figure comes from measuring the five
  controls currently in the bar; adding a sixth would eat the slack. That is why the rule in the
  spec is stated as *nothing clipped and nothing overlapping*, which stays testable at any width,
  rather than as a pixel value.
- **The three-language row is the single largest part of the bar** at 185px. Folding it away fixes
  the width, and also makes switching language a two-click action on a narrow screen. Accepted:
  language is set once, and the alternative is losing the sign-out button off the edge.
- **Precedence between a fixed dial and a sticky bar is a stacking-context question**, and stacking
  contexts are easy to get subtly wrong — a `transform` or a `backdrop-filter` on an ancestor
  creates one. The test asserts what the user sees at a point on the screen, not the computed
  `z-index`, so a rule that is right on paper and wrong on screen still fails.
- **Filtering the item list narrows what a user can pick**, and if `is_stock_tracked` is wrong in
  master data the item simply will not appear — a silent absence rather than the current explicit
  refusal at submit. The refusal stays on the server, so a stale client cannot submit an untracked
  item regardless; but a mis-flagged item is now invisible rather than rejected with a reason. This
  is the accepted cost of not offering what will not be honoured, and it is why the flag belongs in
  master data where it can be corrected.

# Let the screen say what it means

## Why

Driving the create wizard through the seeded types with a mouse surfaced four presentation defects.
None of them is a broken calculation; each is the screen telling the user something that is not true,
or refusing to tell them something it knows.

**The topbar runs off the screen below about 700px.** Measured at a 482px viewport: the brand wraps
to two lines — rendering as `HA` / `ER` — and **122px of the action row is clipped beyond the right
edge**, taking the theme toggle, the palette button and the logout menu with it; `中文` is cut in
half at the boundary. (An earlier reading of this called the company selector "drawn on top of" the
brand. Measuring it, they abut exactly — the brand ends at x=117 and the selector begins there. The
defect is clipping and wrapping, not overlap.)

The bar is a single non-wrapping row and only part of it collapses. There is already a breakpoint at
991px that folds the logout button behind an ellipsis menu, but the group beside it — company
selector, notification bell, three language buttons, theme toggle, palette — never collapses at any
width. Its intrinsic width is **500px** on its own, of which the three language buttons are **185px**:

```
company selector 154   bell 35   language 185   theme 35   palette 35   + gaps 64   = ~500px
```

Add the brand and the bar's own 56px of padding and nothing narrower than roughly 700px can hold it.

This matters more than it looks: the company selector is how a user in more than one company knows
*which company they are about to create a document in*, and the controls being pushed off the edge
include the only way to sign out.

**A WhatsApp button floats over every screen, including the login page.** `App.vue` mounts
`WhatsAppSpeedDial` outside `<router-view>`, `position: fixed`, so it renders before anyone has
authenticated and on every route thereafter. Two consequences: a support channel is offered to an
unauthenticated visitor, and — because it is pinned bottom-right — it sits over the wizard's
**Next** and **Save and submit** buttons, which live in the same corner. The primary action of the
screen is underneath a floating button that belongs to no screen in particular.

**The review step omits fields the user was required to fill in.** The wizard collects the warehouse
on step 1 for a goods issue, and the employee for a promotion. Neither appears in the review summary,
which lists only the type, the dynamic form fields and the lines. The review step is the last screen
before a document becomes somebody else's work, and it silently drops two of the values that decide
what the document does — the warehouse the stock leaves, and the person a promotion is about.

**The line editor offers items the document type cannot use.** Raising a goods issue and picking
`A4 Paper` from the item list produces, at submit:

```
Line 1 names 'I001', which is not stock-tracked
```

The list offered all three seeded items; only `Safety Helmet` is stock-tracked. The server is right
and the message is clear, but the user could only learn it by finishing the form. `web-inventory`
already requires the opposite — *"The line editor SHALL offer only items whose `is_stock_tracked` is
true"* — and that clause was recorded as unbuilt when the wizard's warehouse fields were added.

**The client cannot currently obey that clause.** `GET /items/enabled` returns an `EnabledItem` of
`{id, itemCode, name, category, defaultUnit, isActive, defaultGlAccount}` — `is_stock_tracked` is on
the entity but is not in the payload. So this one is not purely presentational after all: the read
has to carry the flag before any filter can be written against it. That is an additive field on an
existing response, not a change to any refusal.

**All four were re-confirmed on a second pass**, signed in as `requester` rather than `admin`: the
WhatsApp button on the login form before authenticating; the review step omitting the warehouse on a
goods issue *and* the employee on a promotion; the item list offering all three items on a goods
issue; and the topbar measurements above.

**The common shape.** Three of the four are the same mistake in different places: a screen that
offers or displays something the system will not honour. That is the rule the document wizard was
just rebuilt around — do not offer what cannot be finished — applied to controls rather than to
document types.

## What Changes

**The topbar reflows instead of overlapping.** Below its breakpoint the bar collapses the parts that
are not identity — the language buttons and the secondary actions — behind the existing menu, and the
brand and the company selector keep their own space. No element may be drawn over another, and no
control may be clipped by the viewport edge.

**The floating support button stops covering the page's primary action, and stops appearing before
sign-in.** It moves inside the authenticated layout rather than wrapping the router view, so the
login screen does not offer it. Where a screen has a sticky action area in the same corner, the
button yields to it: a screen's own primary action is never the thing hidden by a global affordance.

**The review step shows every value the wizard collected.** The document-level choices — warehouse,
destination warehouse, employee, vendor, payee — appear beside the form fields, so what is reviewed
is what will be submitted. A required value that is missing is already marked as missing; this
extends the same completeness to values that are present.

**The line editor offers only items the type can use.** For a stock-moving type the list is filtered
to stock-tracked items, which is what `web-inventory` already specifies. A refusal the form can
prevent should not be a refusal the server has to make.

## Who this answers

| party | what they saw | after |
| --- | --- | --- |
| anyone on a narrow screen | the brand and the company selector drawn on top of each other, `中文` cut off | the bar reflows; nothing overlaps or is clipped |
| anyone finishing a wizard | the Next / Save-and-submit button under a floating WhatsApp button | the screen's own action is on top |
| a visitor at the login page | a support channel offered before signing in | nothing but the login form |
| whoever reviews before submitting | no warehouse and no employee in the summary | every collected value is shown |
| whoever raises a goods issue | picked an item from the list and was refused for it at submit | the list only offers items the type can move |

## What This Change Does NOT Do

- **Does not remove the WhatsApp button.** Where it lives and what it may cover are the questions;
  whether to offer support is not.
- **Does not redesign the topbar.** The parts stay as they are; what changes is that they reflow
  rather than overlap once the bar runs out of room.
- **Does not change any server refusal.** Every message quoted here is correct and stays. The change
  is which of them a user can reach by using the form as offered.
- **Does not show available stock beside the quantity input.** The same `web-inventory` clause that
  requires the item filter also requires *"each selected item's available quantity in the chosen
  warehouse beside the quantity input, so a shortage is visible before submit rather than as a
  server rejection"*. Re-testing walked straight into the failure that clause predicts — a goods
  issue reached submit and was refused `Insufficient stock — need 4.0000, available 0.0000`. Building
  it needs a warehouse-scoped stock-balance read the client does not have, which is a slice of its
  own rather than a presentation fix. Named here so it is deferred deliberately, not forgotten.
- **Does not rewrite the server's stock message.** That refusal names its item and warehouse by UUID
  (`item 39833f80-… in warehouse 5d014a0c-…`) rather than by code. Worth fixing, but it is server
  message text and belongs with the availability slice above, where the codes are already to hand.
- **Does not address the two functional defects found alongside these.** `PUT /documents/:id/lines`
  answers 500 rather than 400 when a line omits `lineAmount` (MikroORM's required-property error
  escapes as a server error), and a `requires_item` document with zero lines submits happily —
  the same vacuous-truth hole that `finish-every-document-the-wizard-offers` closed for budget
  documents and vouchers, still open for item-bearing ones. Both are server behaviour and belong in
  their own change.

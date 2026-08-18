# Tasks — Let the screen say what it means

## 1. The topbar fits

- [x] 1.1 The brand never wraps. `HA` / `ER` is a broken brand, not a smaller one.
- [x] 1.2 The preference controls — language, theme, palette — fold into the ellipsis overflow menu
      the bar already uses for sign-out. **Revised from the design's ≤767px to the existing 991px
      breakpoint**, on measurement: with sign-out and the preferences all inline the row needs
      ~777px, so a 767px fold would still overflow by ~9px at exactly 768. Moving them into the
      panel that already collapses at 991px removes the need for a second breakpoint at all.
- [x] 1.3 The company selector and the notification bell stay visible at every width (D1 — they
      state the working context; the folded ones state a preference).
- [x] 1.4 At ≤479px the wordmark is hidden, keeping the logo image, and the company selector stops
      being a fixed `w-44` so it can shrink.
- [x] 1.5 The bar's height does not change with the viewport — the layout offsets against it.
- [x] 1.6 Theme tokens only, no hardcoded colours. i18n for anything newly labelled in the menu.

## 2. The floating affordance yields

- [x] 2.1 `WhatsAppSpeedDial` moves out of `App.vue` (where it is a sibling of `<router-view>` and so
      renders on the login form) and into the authenticated layout.
- [x] 2.2 A page-level sticky action area paints above the dial, and is opaque enough that the dial
      does not show through — the wizard's bar is currently `bg-surface-0/90` with a backdrop blur.
- [x] 2.3 State the precedence as a rule rather than nudging this one screen: moving the dial to
      another corner only picks a different screen to collide with later.

## 3. The review step is complete

- [x] 3.1 The review header renders a tile for every document-level value the wizard collected —
      warehouse, destination warehouse, employee, payee — beside the existing type, currency and
      vendor.
- [x] 3.2 Drive the tiles from the same `document_type` flags that decided whether to render each
      input (`requires_*`, and `post_action` for the transfer destination), not from a hand-written
      list. A hand-written list is exactly how warehouse and employee came to be missing.
- [x] 3.3 A value the type does not ask for renders no tile.
- [x] 3.4 A missing required value keeps its existing "missing" treatment.

## 4. The line editor offers only usable items

- [x] 4.1 `EnabledItem` and `GET /items/enabled` carry `isStockTracked`. Additive: same permission,
      no existing field changes meaning. Without it the client has nothing to filter on (D4).
- [x] 4.2 The client `Item` type carries the flag through.
- [x] 4.3 For a stock-moving type the line editor offers only stock-tracked items. Decide which
      types those are from `post_action` (`ISSUE_STOCK`, `ADJUST_STOCK`, `TRANSFER_STOCK`), never
      from a list of document-type codes (invariant 7).
- [x] 4.4 Every other type keeps the full list — a requisition may legitimately name a service.
- [x] 4.5 No server refusal changes. The submit-time check stays exactly as it is, so a stale client
      still cannot submit an untracked item.

## 5. Tests

- [x] 5.1 Topbar geometry — **measured in the browser, not in a unit test.** jsdom has no layout
      engine, so a vitest assertion on widths would be meaningless. Recorded numbers: at 482px
      `clippedElements: []` and the brand on one line (was 122px clipped, brand on two); at 360px
      `clipped: []`, wordmark hidden, selector shrunk to 106px; bar height 56px at every width.
      The unit tests below assert the composition that produces that geometry.
- [x] 5.2 Topbar: the company selector and bell remain visible when collapsed; the preference
      controls are reachable in the overflow menu.
- [x] 5.3 The dial is absent on the login route and present inside the authenticated layout.
- [x] 5.4 Click precedence — **measured in the browser** for the same reason as 5.1. At the exact
      overlap point `document.elementFromPoint` returns `p-button` inside the action bar, not the
      dial (`barPaintsOnTop: true`, dial z 500, bar z 600). Asserting the point rather than the
      `z-index` was the right call: the dial's `z-index` was `auto` before this change, so a
      z-index assertion would have looked fine while the dial sat on top.
- [x] 5.5 Review: a warehouse-requiring type shows its warehouse; an employee-requiring type shows
      its employee; a transfer shows both ends distinguishably; a type requiring neither shows
      neither.
- [x] 5.6 Items: a stock-moving type offers only stock-tracked items; a non-stock type offers all.
- [x] 5.7 Server: `/items/enabled` reports the flag, and the read is otherwise unchanged.
- [x] 5.8 Mutation-checked, eight mutations, all caught:

      | mutation | result |
      | --- | --- |
      | bind the unfiltered item list to the editor | caught — **only after strengthening the test** |
      | ignore `isStockTracked` in the filter | caught |
      | review renders none of the collected values | caught (4 tests) |
      | omit the warehouse tile (the original defect) | caught (3) |
      | omit the employee tile (its other half) | caught (1) |
      | dial back in `App.vue`, on the login form | caught |
      | language control back in the always-visible group | caught |
      | server stops sending `isStockTracked` | caught |

      The first mutation **survived on the first attempt**: the test read the `offerableItems`
      computed, so rebinding the template to the raw array changed nothing it looked at. Rewritten
      to read the prop `LineItemsEditor` actually receives. A test of the computation is not a test
      of the wiring.

## 6. Verification

- [x] 6.1 back 1581 passed / 2 failed — the two known date-dependent ones (attendance correction;
      journal-voucher delegation), confirmed unchanged by re-running both specs directly.
      `tsc -p tsconfig.build.json --noEmit` clean.
- [x] 6.2 front 842 passed (94 files), `vue-tsc -b` clean. Using the real typecheck earned its keep
      twice here: it caught a `f.optionsJson` regression that all 842 tests were happy with, because
      no test covers the dropdown path.
- [x] 6.3 Walkthrough as `requester`. Topbar clean at 360/482/desktop with the overflow panel
      holding Language / Toggle dark mode / Theme / Log out; the dial is gone from the login form
      and sits behind the wizard's action bar; the goods-issue item list offers **only Safety
      Helmet** (A4 Paper and Toner no longer appear); the review step shows
      **Warehouse — MAIN — Main store** beside the document type.
- [x] 6.4 `openspec validate --all`.

## 7. Damage done and repaired during this change

- [x] 7.1 `git checkout -- CreateDocumentView.vue`, used twice to undo a mutation, reverted the file
      to `ea8c12b` and destroyed every uncommitted edit in it — including the whole client half of
      the already-archived `offer-only-the-doors-you-can-open`. Re-applied from the archived
      change's own text: the two selection reads (`selectableWarehouses` / `employeesApi.selectable`
      in place of the administration lists), the `unreachable` computed and its binding to
      `DocumentTypePicker`, and the `f.options` dropdown fix. Verified by the 50 document tests
      (which include that change's specs) and by the UI, where the disabled cards still name
      `GL_JV_POST` and `BUDGET_VIEW`.
- [x] 7.2 Mutation testing now restores from a scratch copy taken before the mutation, never from
      git. `git checkout` cannot tell a mutation from a day of uncommitted work.

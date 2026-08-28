## 1. Read model

- [x] 1.1 Add the document's `budget_movement` rows to the detail read — movement type, the budget
      (id, code, name, department) and the amount — scoped to the active company like the rest of
      the read.
- [x] 1.2 Return an empty list rather than omitting the key, so a reader can tell "no movements"
      from "not read".
- [x] 1.3 Money stays a decimal string end to end; no step converts through a JS number.

## 2. Document detail screen

- [x] 2.1 Render the movements where lines are rendered today, for a document that has them.
- [x] 2.2 Show the movement type in words, the budget's code and name, and the amount formatted to
      the company base currency's `decimal_places`.
- [x] 2.3 Link the budget to its own page, gated on `BUDGET_VIEW` the way other permission-gated
      links on this screen are.
- [x] 2.4 A document with no movements looks exactly as it does today — no empty section.
- [x] 2.5 Three locales for any new label.

## 3. Approval dialog

- [x] 3.1 Show the same movements in the approve dialog, beside the proposed amount, from the same
      payload the detail read returns — not a second summary composed there.
- [x] 3.2 A document with no movements shows the dialog unchanged.

## 4. Tests

- [x] 4.1 A plan document's detail read returns its `ACTIVATE_BUDGET` movement with the budget and
      the amount.
- [x] 4.2 An adjustment document returns its `ADJUST_INCREASE` movement.
- [x] 4.3 A document whose content is lines returns an empty movement list and unchanged lines.
- [x] 4.4 Company isolation: the movements of another company's document are not resolvable.
- [x] 4.5 The detail view renders the budget code, name and amount for a movement document.
- [x] 4.6 The approve dialog renders them too.
- [x] 4.7 The existing document detail and approval suites pass unchanged.

## 5. Verify against the document that started this

- [x] 5.1 Open `BUDGET_PLAN-HAL-2026-0001` and confirm it now names budget `1.106` and
      12,000,000 instead of reading "ບໍ່ມີລາຍການ".
- [x] 5.2 Open one of the `SPEND_HIST` documents and confirm nothing about it changed.

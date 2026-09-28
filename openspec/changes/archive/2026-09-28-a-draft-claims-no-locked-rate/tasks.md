## 1. Detail view

- [x] 1.1 In `DocumentDetailView.vue`, gate the base-total and exchange-rate tiles on the document
      having left `DRAFT` as well as on `isForeignCurrency`, with a comment saying why a draft's
      stored figures are either absent or withdrawn.
- [x] 1.2 Apply the same condition to the lock date and to any per-line base amount the detail
      renders, so the screen does not state half a stamp.

## 2. List view

- [x] 2.1 In `MyDocumentsView.vue`, render the base-currency column's existing empty state for a
      `DRAFT` row rather than the stored `baseTotalAmount`.

## 3. Tests

- [x] 3.1 Component test: a foreign-currency `DRAFT` detail shows no locked rate and no base total.
- [x] 3.2 Component test: the same document, submitted, shows both — the regression guard, since the
      fix is a condition and an over-broad one would hide them everywhere.
- [x] 3.3 Component test: a draft carrying a stamped rate from a withdrawn submission (the returned
      case, which is the one that produced the bug) shows neither.
- [x] 3.4 Component test: the list shows the empty state for a draft row and the figure for a
      submitted row.

## 4. Verify

- [x] 4.1 Run the `front-end/` unit suite and the REAL typecheck (`vue-tsc -b`).
- [x] 4.2 Confirm `git diff --stat` touches `front-end/` only — no server file, no stored value.

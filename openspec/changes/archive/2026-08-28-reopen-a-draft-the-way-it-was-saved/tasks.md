## 1. Restore what was saved

- [x] 1.1 The line's budget restores through `idOf`, which takes a populated `budget` or a bare
      `budgetId`. `item` and `taxCode` moved to the same helper rather than keeping their longhand.
- [x] 1.2 `moneyMovedOn` restores, parsed at local midnight so `DatePicker` shows the stated day
      rather than the day before in a positive-offset timezone.
- [x] 1.3 Audited the create payload against the edit prefill and found **two more**:
      `vendorInvoiceNo` and `vendorInvoiceDate` were sent on create and never read back. Both are
      required at submit when the document claims input VAT, so reopening a draft to fix a line
      silently cleared the invoice it claims against. Fixed with the rest.

## 2. Make the class of bug harder to repeat

- [x] 2.1 One list of the fields the form owns, used to build the save payload and to populate on
      load, so a field added to create cannot be forgotten in edit.
- [x] 2.2 Land this after group 1, so the user-facing bug is fixed before the refactor.

## 3. Say what could not be restored

- [x] 3.1 A value that cannot be restored — a budget since closed, an item withdrawn — shows as
      missing and required rather than as an empty control.

## 4. Tests

- [x] 4.1 Reopening a draft restores the line's budget from a populated `budget` object.
- [x] 4.2 Reopening restores `moneyMovedOn`, and saving without touching it keeps the day.
- [x] 4.3 The regression that started this: open a `SPEND_HIST` draft with a stated day, change the
      amount only, save — the day is unchanged.
- [x] 4.4 A line whose budget no longer resolves shows the field as missing, not as empty.
- [x] 4.5 The existing create/edit wizard suite passes unchanged.

## 5. Verify in the app

- [x] 5.1 Reopen `SPEND_HIST-HAL-2026-0002`, confirm the budget and the day come back filled in.
      The day comes back filled (`2026-03-14`, local midnight — not the 13th). The budget comes back
      on the line (`aecd9a50-…`, read from the populated `budget` the detail returns) but this
      login cannot OFFER it: the admin's department is HQ, the document's is ADM, and
      `/budgets/selectable` is asked for the requester's department. That is the task-3.1 case, and
      it is what turned up the bug in the guard below.

      **Found while verifying:** treating "the option list is non-empty" as "the list has loaded"
      hid the unavailable state in exactly the case that matters — a department offering NO budget
      returns a fully-loaded empty list. Replaced with an explicit `optionsReady` flag driven by
      `loadingData`; the picker now reads red and says the saved budget is no longer available.

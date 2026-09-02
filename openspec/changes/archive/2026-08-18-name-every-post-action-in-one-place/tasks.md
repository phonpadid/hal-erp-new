# Tasks — Name every post-action in one place

## 1. The one declaration

- [x] 1.1 In `shared/src/index.ts`, `POST_ACTIONS` becomes the twelve the engine dispatches, with an
      exported `PostAction` type. Drop `'NONE'` from it — the sentinel is a form concern (D2), not a
      member of the set.
- [x] 1.2 `RESERVING_ACTIONS` and `MOVEMENT_POST_ACTIONS` move beside it, typed as subsets of
      `PostAction` so a rename breaks them at compile time.
- [x] 1.3 `documentTypeSchema.postAction` uses the set and accepts `null` for absence.

## 2. Backend

- [x] 2.1 `document.entities.ts`: `postAction?: PostAction`. Without this the switch is over `string`
      and `assertNever` cannot compile (D4) — do this before 2.4.
- [x] 2.2 Both DTOs (`config.dto.ts:138`, `:183`) constrain the value to the set and accept null.
- [x] 2.3 Every bare literal reads the shared constant: `matching.service.ts`, `owed.ts`,
      `document-submit.service.ts` (×2 plus the local `RESERVING_ACTIONS`), `budget.service.ts`,
      `budget-adjustment.service.ts`, `budget-plan.service.ts`, `journal-voucher.service.ts`. The two
      `POST_JOURNAL` declarations collapse into one import.
- [x] 2.4 `post-action.service.ts`: `default:` goes, `assertNever(action)` replaces it.
- [x] 2.5 `document-type.service.ts` refuses a second active `POST_JOURNAL` type per company, on
      create and on update (D7).

## 3. Migration

- [x] 3.1 Normalise `post_action = 'NONE'` to `null` **first**, then add the CHECK admitting null or
      one of the twelve. The other order fails on the rows this exists to clean (D3).
- [x] 3.2 `down()` drops the constraint only. It must not restore `'NONE'`: reinstating the sentinel
      is reinstating the bug.

## 4. Frontend

- [x] 4.1 The Select is built from the shared set. The sentinel was removed rather than mapped: it
      would have to pass the same shared schema the server validates against, so either the schema
      accepts a value the column refuses or the form cannot submit — the suite caught exactly that.
      The no-action option carries `null`, which the wire and the column already agree on. D2 is
      updated.
- [x] 4.2 Remove the fallback at `DocTypeFormView.vue:68` that appends an unknown stored value — with
      the set closed there is no value it can catch.
- [x] 4.3 i18n labels for the five actions the Select never offered, in all three locales.

## 5. Reference documents

- [x] 5.1 `erp_approval_system.dbml` line 666: the note lists the twelve. CLAUDE.md directs everyone
      to reference it exactly and it has been five short.

## 6. Tests

- [x] 6.1 An unknown `post_action` is rejected on create and on update.
- [x] 6.2 A type created with no post-action stores `null`; the sentinel string is rejected like any
      other unknown value.
- [x] 6.3 A type whose `post_action` is `null` still approves to terminal, running nothing.
- [x] 6.4 A second active `POST_JOURNAL` type for a company is refused; one is allowed after the
      first is deactivated; two `TRANSFER` types are allowed.
- [x] 6.5 The set and the dispatcher agree. Written first as a test that scanned the switch's source
      text, then deleted: it could not see `case POST_JOURNAL:` (the constant is declared in another
      file) and it duplicated a guarantee the compiler already gives more strongly. `assertNever`
      holds the rule — verified by adding a thirteenth member, which fails `nest build` at the exact
      line. The build is the lockstep test.
- [x] 6.6 Frontend: the Select offers every action; the no-action choice sends `null`.
- [x] 6.7 Each new test must fail with its feature removed. Check it.

## 7. Verification

- [x] 7.1 back 1561 passed / 1 failed (the date-pinned attendance test, unrelated); `nest build`
      clean; front-end 814 passed (+2) and `vue-tsc` clean; `openspec validate --all` 72/72.

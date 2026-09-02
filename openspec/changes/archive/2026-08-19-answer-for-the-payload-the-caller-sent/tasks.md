# Tasks — Answer for the payload the caller sent

## 1. Validate the two array bodies

- [x] 1.1 `PUT /documents/:id/lines` declares its element class — `ParseArrayPipe` with
      `items: DocumentLineInput`, `whitelist: true`, `forbidNonWhitelisted: true`. The settings are
      written out at the site on purpose: they must match the global pipe, and the endpoint is where
      that is checkable (D1).
- [x] 1.2 The same for `PUT /documents/:id/fields` with `FieldValueInput`.
- [x] 1.3 No decorator is added to either class. They are already complete — that is the point of
      the defect. If one turns out to need a rule, that is a different change.
- [x] 1.4 Confirm the rejection body is the validator's array of strings, the shape
      `utils/apiError.ts` joins for display, and not some other structure `ParseArrayPipe` produces.
      Read it off a real response, do not assume (design risk).

## 2. Answer 400 for a refusal from below the DTO layer

- [x] 2.1 `CodedExceptionFilter` recognises MikroORM's data-validation failure and answers 400 with
      `VALIDATION_FAILED` — a code that already exists and already means *caller bug, never retry*.
- [x] 2.2 The ORM's message passes through, because it names the missing value and nothing else
      would (D3). It exposes an entity property name; that is the accepted cost, recorded here so
      the next reader knows it was decided rather than missed.
- [x] 2.3 Logged at `warn`, not dropped. The same shape can mean the system failed to set a value,
      and after this the status no longer distinguishes that from a bad payload (D4).
- [x] 2.4 The 500 branch keeps everything it does not recognise: same message, same code, same
      `error` log.
- [x] 2.5 The body keeps its four fields in their existing meanings. The web app must not be able to
      tell this branch exists (D5).

## 3. `requires_item` means at least one line

- [x] 3.1 The emptiness check sits inside the existing `if (docType.requiresItem)` block,
      immediately before the per-line one, and rejects with the same shape.
- [x] 3.2 Do **not** make "has lines" a general rule — a type requiring no items may be submitted
      with none (D6).
- [x] 3.3 Leave `requires_budget` alone. Its `.find()` has the identical shape one block below and
      is already backstopped by `reserveLines.length === 0`. Noting it so the asymmetry reads as
      considered.

## 4. Tests

- [x] 4.1 `PUT :id/lines` with an element missing `lineAmount` → 400 naming the field, **not** 500.
      This is the exact request that produced `INTERNAL_ERROR` on the running API.
- [x] 4.2 `PUT :id/lines` with an unknown field → 400. Today it answers 204 and ignores it.
- [x] 4.3 `PUT :id/fields` with a non-UUID `formFieldId` → 400.
- [x] 4.4 A valid array still writes and still answers 204 — the assertion that stops the fix from
      simply breaking both endpoints.
- [x] 4.5 The filter: an ORM data-validation failure → 400 + `VALIDATION_FAILED`; anything else →
      500 + `INTERNAL_ERROR` with the opaque message. Both directions, in
      `coded-exception.filter.spec.ts` where the existing branches are already covered.
- [x] 4.6 Submit an item-mandatory type with zero lines → rejected, document still DRAFT, nothing
      reserved. Assert the reservation absence, not only the status: the point of the gate is that
      it runs before any hold.
- [x] 4.7 Submit a type with `requires_item = false` and no lines → still accepted.
- [x] 4.8 Each new test must fail with its feature removed. Check it, record what was mutated, and
      restore from a scratch copy — never `git checkout`.

## 5. Verification

- [x] 5.1 back `npx vitest run`, **one suite at a time** — concurrent runs share the test database
      and the tell is the skip count leaving 36. Expect the known date-dependent attendance failure.
- [x] 5.2 back `npx tsc --noEmit` adds no errors beyond HEAD's (compare counts; the project has a
      large pre-existing set, so the delta is what matters).
- [x] 5.3 front `npm run typecheck` and `npx vitest run` — nothing client-side changes, so this is a
      regression check that the response shape did not move.
- [x] 5.4 `openspec validate --all`.
- [x] 5.5 Against the running API, the two requests from the proposal, on a document created for
      the purpose: the missing-`lineAmount` one
      now 400 naming the field, the unknown-field one now 400. Use a document created for the
      purpose — **not** an existing draft. `setLines` deletes every line before writing, so probing
      a real document destroys its contents; that is how `ISSUE-HAL-2026-0001` lost its lines while
      this defect was being confirmed.

## 6. Scope deliberately left out

- [x] 6.1 **No new validation rules.** Every decorator is unchanged; two endpoints start running the
      ones they already had.
- [x] 6.2 **The rest of the API is not surveyed for unvalidated body shapes.** Two bare-array bodies
      exist today and both are fixed; nothing prevents a third being added tomorrow.
- [x] 6.3 **`INTERNAL_ERROR` responses are not audited for other misattributions.** One provably
      caller-caused shape is fixed; whether others answer 500 for something a caller could act on
      has not been looked at.
- [x] 6.4 **The client is untouched**, and the response body's shape is unchanged so it stays that
      way.
- [x] 6.5 **`ISSUE-HAL-2026-0001` is not repaired.** Its lines were destroyed by the probe that
      confirmed this defect and the original values are not recoverable. Left for the user to
      decide, not silently invented.

## 7. Found while applying

- **The refusals now land before `setLines` runs**, so a malformed body no longer reaches the
  delete-then-rewrite. That is the exact path that destroyed `ISSUE-HAL-2026-0001`'s lines while
  this defect was being confirmed: under the old behaviour a rejected payload still cost the
  document its contents. Verified live — the throwaway document kept its line through both
  refusals.
- **The detail is on the response body, not on `.message`.** `BadRequestException.message` is
  Nest's generic "Bad Request Exception"; the array naming the field is on `getResponse()`. Four
  tests asserted the wrong one and passed for the wrong reason until the run showed it. Worth
  knowing: `toThrow(/fieldName/)` on a validation refusal proves nothing.
- **`em.create(DocumentType, …)` in this spec file does not typecheck** — two existing fixture
  lines already carry the error. The new one uses the `as never` form the more recent specs use, so
  the change adds no error rather than a third instance of an old one.


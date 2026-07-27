## 1. The mechanism

- [x] 1.1 Add a `CodedException` (or an equivalent seam) under `back/src/common/` that carries a
  stable `code` alongside the HTTP status and message, and an enum or const map of the named codes.
  Write the rule in the file: a code exists because a caller does something different, not because
  a line can throw.
- [x] 1.2 Add a global exception filter that passes the existing body through unchanged —
  `statusCode`, `message` (string or array), `error` — and adds `code`: taken from the exception
  when it carries one, otherwise derived from the HTTP status (`400 → BAD_REQUEST`, `404 →
  NOT_FOUND`, `403 → FORBIDDEN`, `409 → CONFLICT`, `500 → INTERNAL_ERROR`).
- [x] 1.3 Recognise the `ValidationPipe`'s exception and code it `VALIDATION_FAILED`, leaving its
  array `message` exactly as it is.
- [x] 1.4 Register the filter in `back/src/main.ts`, next to the existing `ValidationPipe`.

## 2. Name the four

- [x] 2.1 `BUDGET_EXCEEDED` at the hard stop in `BudgetLedgerService` — where the refusal is
  decided, so every path that reserves budget inherits it, including ones written later.
- [x] 2.2 `QUOTA_EXCEEDED` at the equivalent hard stop in the quota ledger. Separate from the
  budget code on purpose: what has to be topped up is different.
- [x] 2.3 `INVALID_STATE` on the document state guards a caller actually hits — submit, cancel,
  and settle. Do NOT sweep every state check in the codebase into it; only the ones on paths an
  integration calls.
- [x] 2.4 Leave the other ~250 throw sites alone. If the diff is touching them, stop and re-read
  the design.

## 3. Prove it

- [x] 3.1 Spec: a hard-stop budget refusal returns `BUDGET_EXCEEDED`, and no `budget_txn` was
  written.
- [x] 3.2 Spec: a hard-stop quota refusal returns `QUOTA_EXCEEDED`.
- [x] 3.3 Spec: submitting a document that is not `DRAFT` returns `INVALID_STATE`.
- [x] 3.4 Spec: a DTO failure returns `VALIDATION_FAILED` **and** keeps `message` as the array of
  validation strings — assert the array, not just the code, because that array is what the web app
  joins for display.
- [x] 3.5 Spec: an uncoded `BadRequestException` produces a body whose `statusCode`, `message` and
  `error` are exactly what they are today, plus the derived code. This is the regression guard for
  every one of the 250 sites this change does not touch.
- [x] 3.6 Spec: `NotFoundException`, `ForbiddenException` and `ConflictException` each derive their
  code from the status.
- [x] 3.7 Frontend spec: `messageOf` still extracts the message from a body that now carries a
  `code`, for both the string and the array shape. The web app must not notice this change.

## 4. Verify

- [x] 4.1 Run the full `pnpm --filter back test`.
- [x] 4.2 Run `pnpm --filter front-end run ci` — the error parser is the one place the web app
  could break.
- [x] 4.3 Run `pnpm --filter back boot:check` — a global filter is app-level wiring the specs do
  not exercise.

## 5. Tell the caller who asked

- [x] 5.1 Replace the "being added" paragraph in `docs/claim-integration.md` with the real bodies
  for all three cases the claim team named — captured from an actual response, not written by hand.
- [x] 5.2 Say in the guide which codes are the contract and that an unnamed generic may change, so
  nobody builds on a code we did not promise.

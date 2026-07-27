## Why

An integration cannot tell our failures apart. `POST /documents/:id/submit` answers `400` when the payload is malformed, when the budget is exhausted, and when the document is in the wrong state — and those mean three different things to the caller:

```
   payload is wrong     → a bug in their code. Fix it. Never retry.
   budget exhausted     → a business event. Hold the case, tell someone, submit again later.
   wrong state          → already handled. Skip it.
```

Today the only thing separating them is English prose:

```json
{ "statusCode": 400,
  "message": "Over budget: 4500.00 requested, 1200.00 available on budget 8f3d…",
  "error": "Bad Request" }
```

The claim team asked for a stable code and said it would help them more than anything else we could give them. They are right, and matching on that string would be worse than nothing: it carries a uuid and two amounts, and we are free to reword it any day.

This is not a courtesy to one integration. Any caller that has to decide whether to retry needs the same thing, and today the only correct behaviour is "give up and ask a human", which is what the guide currently tells them to do.

## What Changes

- Every error response gains a stable, machine-readable `code`. `message`, `statusCode` and `error` keep their exact current shape and meaning — the web app reads `message` (string or class-validator's array) and must not notice this change.
- A small set of codes, defined by what a caller must branch on rather than by what can throw:
  - `BUDGET_EXCEEDED` — a hard-stop budget refused the reservation
  - `QUOTA_EXCEEDED` — the same, for quota
  - `INVALID_STATE` — the document is not in a state where this operation applies
  - `VALIDATION_FAILED` — the payload did not pass DTO validation
  - a generic default derived from the HTTP status for everything else
- The default is what keeps this small. There are 255 `BadRequestException` sites in the backend; **this change rewrites almost none of them.** Existing throws keep working and get the generic code; only the handful a caller branches on are given a specific one.
- The claim integration guide gets the real example bodies it was promised, after they exist rather than before.

## Capabilities

### Modified Capabilities

- `platform-foundation`: a new requirement that every error response carries a stable code alongside its human message, and that the codes name situations a caller must act on differently.

### New Capabilities

None.

## Impact

- `back/src/common/` — an exception carrying a code, and a global filter that shapes the body.
- `back/src/main.ts` — registering the filter.
- A handful of throw sites: the budget hard stop, the quota hard stop, and the document state guards on submit, cancel and settle.
- `docs/claim-integration.md` — replace the "being added" note with the real bodies.
- No entity, migration, DTO, endpoint, or permission code changes. No invariant in CLAUDE.md is touched: this changes how a failure is described, never whether it happens.
- **Backwards compatible by construction.** The body gains a field; nothing is renamed or removed. `messageOf` in the web app reads `response.data.message` and keeps working unchanged, including the array class-validator produces.

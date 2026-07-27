## Context

The backend has no exception filter. `main.ts` registers a `ValidationPipe` and nothing else, so every error body is whatever Nest's default handler produces:

```json
{ "statusCode": 400, "message": "…", "error": "Bad Request" }
```

and for a DTO failure, `message` is an array of strings.

Two facts bound the design.

**There are 255 `BadRequestException` sites.** Nineteen of them are in the submit path alone. Touching all of them would be a large, mechanical, review-resistant diff over code that currently works, in exchange for codes almost nobody would branch on.

**The web app parses `message` and nothing else.** `utils/apiError.ts` reads `e.response.data.message`, joins it if it is an array, and falls back to a default. Every error toast in the product goes through that one function. Whatever this change does, `message` has to come out the other side identical.

So the shape of the answer is: add a field, default it, and name only what matters.

## Goals / Non-Goals

**Goals:**
- A caller can distinguish "the budget refused this" from "your payload is wrong" without reading English.
- The distinction survives us rewording messages.
- Existing throws keep working untouched.
- The web app does not change at all.

**Non-Goals:**
- A code for every failure. A code nobody branches on is a maintenance cost with no reader.
- Retrofitting the 255 existing sites.
- Changing HTTP status codes. `BUDGET_EXCEEDED` stays a `400`: the request was well-formed and the server understood it, it just cannot be satisfied now.
- An error catalogue as a public document. The codes named here are the contract; anything else is a generic and may change.
- i18n of `message`. It is English, it is for humans reading logs, and the code is what machines read.

## Decisions

**A field named `code`, alongside `message`, never replacing it.**

```json
{ "statusCode": 400,
  "code": "BUDGET_EXCEEDED",
  "message": "Over budget: 4500.00 requested, 1200.00 available on budget 8f3d…",
  "error": "Bad Request" }
```

The message stays useful and stays human. The code is `SCREAMING_SNAKE`, stable, and part of the contract.

*Alternative — a `type` URI (RFC 7807 problem+json).* Rejected: it would change the body shape for every existing consumer to gain formality nobody asked for, and the web app's parser would have to change on the same day.

**The coded failure is a factory, not a subclass.**

The first attempt was a `CodedException extends HttpException`. It compiled, the filter tests
passed, and the full suite failed on one assertion: a settlement spec doing
`rejects.toThrow(BadRequestException)`. The new class was not a `BadRequestException`, so it stopped
matching — and roughly forty specs across the codebase assert on exception types that way, as would
any `catch (e instanceof …)` written later.

So `coded(code, message, status?)` builds the real Nest exception for that status and attaches the
code to it. Callers, catches and tests see exactly what they saw before, plus a field. This is the
"changes nothing else" promise applied to the type as well as the body — and the one test that
caught it is now joined by an explicit one asserting the instance type.

**A global exception filter that defaults the code, plus a typed exception for the named ones.**

The filter catches everything, preserves the existing body exactly, and adds a code — taken from the exception if it carries one, otherwise derived from the HTTP status (`400 → BAD_REQUEST`, `404 → NOT_FOUND`, and so on). That default is the entire reason this change is small: 255 existing throws become coded without being edited.

*Alternative — a code on every throw, no default.* Rejected. It is the same work as retrofitting everything, and it makes adding a throw require a decision that usually has no interesting answer.

**Codes are chosen by what a caller does differently, not by what can go wrong.**

Four named codes, and each earns its place by a distinct reaction:

| Code | The caller's reaction |
|---|---|
| `BUDGET_EXCEEDED` | hold the case, alert someone, retry later |
| `QUOTA_EXCEEDED` | same shape, different resource — named separately because the thing to top up is different |
| `INVALID_STATE` | stop; the operation no longer applies |
| `VALIDATION_FAILED` | a bug in the caller; never retry |

Everything else keeps a generic. If a fifth code is ever needed, it will be because someone can say what they would do with it.

**`VALIDATION_FAILED` comes from the `ValidationPipe`, not from a throw site.** The pipe already produces a distinct exception with an array `message`; the filter recognises it. So the most common caller bug is coded without touching a single DTO.

**The named codes go on the ledgers' hard stops, not on their callers.** `BUDGET_EXCEEDED` is raised where the budget refuses — inside the ledger service — so every path that reserves budget gets the code, including ones written later that nobody remembered to update.

**No lock, no transaction, no ledger write.** This changes how a failure is reported. It cannot change whether a failure happens: the filter runs after the exception is thrown and the transaction has already rolled back.

## Risks / Trade-offs

**A global filter sees every error in the system, so a mistake in it breaks every error response** → it does one thing (add a field, pass the rest through), the pass-through is asserted for the shapes that exist today including the validation array, and a spec pins that an uncoded exception still produces exactly the body it produces now.

**Codes could drift from what they mean as the code moves** → they are raised at the point the decision is made rather than at the call site, and each is covered by a spec scenario that names the situation rather than the line.

**A caller could start branching on a generic code** and be broken when we later name that case → the guide says the four named codes are the contract and a generic may change; the risk of someone ignoring that is smaller than the risk of naming forty codes today to avoid it.

**The claim team is waiting on this** and might start matching message text in the meantime → the guide already tells them not to, and to treat any `400` from submit as needing a human until this lands. That is a worse experience for a short time, and an honest one.

# Design — Answer for the payload the caller sent

## Context

Three defects on one path, each independently reachable:

```
PUT :id/lines, PUT :id/fields   bare array body → ValidationPipe skips it entirely
    ↓ (a payload nothing checked reaches the ORM)
MikroORM ValidationError         not an HttpException → filter's 500 branch
    ↓ (unrelated: the requirement itself is vacuous)
requires_item                    lines.find(…) on [] → undefined → no rejection
```

The first two are cause and consequence. The third travels with them because it is the same
question asked of the same request — *did the caller send something we can act on?* — and the same
service answers it.

## Goals / Non-Goals

**Goals:**

- Both array bodies get the validation `platform-foundation` already requires of every DTO.
- A refusal raised below the DTO layer is reported as a payload problem, not a server fault.
- An item-mandatory type cannot be submitted with nothing on it.

**Non-Goals:**

- No new validation rules. The decorators exist; two endpoints start running them.
- No change to the response body's shape (D5).
- No change to what a genuine fault answers or logs.
- No survey of other endpoints for unvalidated body shapes.

## Decisions

### D1. `ParseArrayPipe` at the two endpoints, not a wrapper DTO

Three ways to bring an array body inside the pipe:

| | wire contract | where the rule lives |
| --- | --- | --- |
| **`ParseArrayPipe({ items })`** | unchanged | at the endpoint, visible in the signature |
| wrap in `{ lines: [...] }` | **changed** — client must be edited | in a new DTO class |
| subclass the global pipe to unwrap arrays | unchanged | invisible, global, applies to bodies nobody meant |

The wrapper is out because it edits the client to fix a server bug. The global subclass is out
because it changes the behaviour of every endpoint to fix two, and the next person reading
`setLines` still would not see that anything validates it.

`ParseArrayPipe` takes `ValidationPipeOptions`, so `whitelist` and `forbidNonWhitelisted` are passed
explicitly at each site — they must match the global pipe, and saying so at the endpoint is the
point of choosing this option.

### D2. The filter learns the ORM's validation failure, in the one place responses are decided

`CodedExceptionFilter` is already the single answer to "what does an error look like on the wire".
Adding a second filter for `ValidationError` would mean two places to read before knowing what a
caller receives, and `@Catch()` ordering would decide which wins.

So the filter gains one branch: an ORM data-validation failure becomes 400 with
`VALIDATION_FAILED` — a code that already exists and already means *a bug in the caller, never
retry*, which is exactly the advice. The 500 branch keeps everything it does not recognise.

This couples the common error layer to MikroORM. That is a real cost and the alternative — every
service catching and translating — is worse: it is unbounded, it is remembered rather than
enforced, and a path written later would miss it. The same argument the codebase already makes for
raising `coded()` where the refusal is decided.

### D3. The ORM's message passes through, and it names an entity property

MikroORM says *"Value for DocumentLine.lineAmount is required, but is not set."* That names the
missing field, which is the only actionable content there is; rewriting it into something generic
would answer 400 and still leave the caller guessing.

It does expose an entity property name. Those are near-identical to the public field names here, and
the API's prose already carries ids and amounts — but it is an exposure, and it is a deliberate
choice rather than an oversight.

### D4. Still logged, at a level that says whose fault it is

A `ValidationError` almost always means a bad payload, but it can also mean our own code failed to
set a field — and reclassifying that to 400 would hide a server bug behind a caller-blaming status.
It is logged at `warn` rather than dropped: quiet enough not to page anyone for a typo, loud enough
that a pattern of them is visible.

This is the weakest point of the change and worth naming plainly: after it, one class of server bug
looks like a client error in the response, and only the log distinguishes them.

### D5. The body's shape does not change

`utils/apiError.ts` in the web app reads `message` and nothing else, and the filter's own docblock
promises it "must not notice this filter exists". A 400 from this path carries `statusCode`,
`message`, `error`, `code` — the same four fields, in the same meanings.

### D6. `requires_item` gains an emptiness check beside the existing one, not a general one

The vacuous case belongs to the flag, not to documents in general: a type that asks for no items may
legitimately be submitted with no lines, and turning "has lines" into a universal rule would refuse
those. So the check sits inside the existing `if (docType.requiresItem)` block, immediately before
the per-line one, and rejects with the same shape.

`requires_budget` has the identical `.find()` shape one block below and is **not** changed: it is
already backstopped by `reserveLines.length === 0`, which rejects an empty budget document today.
Worth stating so the asymmetry reads as considered rather than missed.

## Risks / Trade-offs

- **A server-side bug now looks like a client error** (D4). Mitigated by the log, not eliminated.
- **Entity property names reach the caller** (D3). Deliberate; they are close to the public names.
- **`ParseArrayPipe`'s message shape must match the global pipe's.** The web app joins an array of
  strings; if the pipe produces a different shape the display degrades silently. To be checked
  against a real response, not assumed.
- **Two endpoints fixed, the class not surveyed.** Both known instances are closed here, and the
  filter branch catches whatever else reaches the ORM — but a third bare-array body added tomorrow
  would repeat D1's mistake, and nothing prevents that.
- **Existing callers sending junk fields now get 400.** That is the intent, and it is a behaviour
  change for anyone relying on the silence. The seeded client does not.

## Migration Plan

None. No schema, no data, no client. Rollback is reverting the commit.

## Open Questions

- **Whether `INTERNAL_ERROR` responses should be audited for other misattributions.** This change
  fixes the one shape that is provably the caller's; there may be others answering 500 for reasons
  a caller could act on. Not surveyed.

# Answer for the payload the caller sent

## Why

Two write endpoints accept a payload nothing has validated, and when the database refuses it the
caller is told the fault was ours.

**Proven live, against the running API:**

```
PUT /documents/:id/lines   [{lineNo:1, description:"x", qty:"1", unitPrice:"5"}]
  → 500 {"code":"INTERNAL_ERROR","message":"Internal server error"}

PUT /documents/:id/lines   [{…, lineAmount:"5", nonsense:"yes"}]
  → 204
```

The first is a caller's payload missing a required field, reported as a server fault. The second is
a non-whitelisted field accepted in silence, on a system configured `forbidNonWhitelisted: true`.

**Neither is a missing rule. The rules exist and simply do not run.** `DocumentLineInput` and
`FieldValueInput` are fully decorated — `@IsNumberString() lineAmount!`, `@IsUUID() formFieldId!` —
and they *are* enforced when the same classes arrive nested inside `CreateDocumentDto`, which
declares `@ValidateNested({ each: true }) @Type(() => DocumentLineInput)`. The update endpoints take
the same classes as a bare top-level array:

```ts
setLines(@Param('id', ParseUUIDPipe) id: string, @Body() lines: DocumentLineInput[])
setFields(@Param('id', ParseUUIDPipe) id: string, @Body() values: FieldValueInput[])
```

A top-level array's metatype is `Array`, which `ValidationPipe` treats as a native type and skips
entirely. So the very same line is validated on create and unvalidated on update.

**This contradicts a requirement the specification already carries.** `platform-foundation` says
every request DTO SHALL be validated via the global `ValidationPipe` with whitelist and
forbid-non-whitelisted. These two endpoints are inside that "every" and outside its effect.

**The 500 is a second defect, and it outlives this cause.** MikroORM's `ValidationError` extends
`Error`, not `HttpException`, so `CodedExceptionFilter` takes it for a genuine fault: logs a stack
and answers `INTERNAL_ERROR`. Validating the two bodies removes the two known ways to reach it —
this one and a stock post-action with no warehouse, since closed at the configuration level — but
not the escape. Any persistence-layer refusal reachable by any path still answers "our fault" for
what is often the caller's payload, and `INTERNAL_ERROR` is precisely the code an integration is
told to retry or escalate on.

**And one requirement is vacuously satisfied.** `requires_item` is enforced by

```ts
const itemless = lines.find((l) => !l.item);   // [] → undefined → no rejection
```

so an item-mandatory type submits happily **with no lines at all**. The neighbouring
`requires_budget` check has the same shape but is backstopped by `reserveLines.length === 0`;
`requires_item` has no such backstop. The spec says the system rejects submit if *any* line has no
item — true of a document with no lines only under a reading nobody intended. A goods issue that
issues nothing passes every gate, routes through approval, and completes.

## What Changes

**Both array bodies are validated.** The two endpoints are brought inside the guarantee the rest of
the API already has: each element validated against its existing decorators, unknown fields
refused, and the failure answered 400 with the validator's array — the shape the web app already
knows how to display. No DTO gains a decorator; the decorators are simply run.

**A persistence-layer refusal answers 400, not 500.** `CodedExceptionFilter` learns one more shape:
a data-validation failure from the ORM is a statement about the payload, and is reported as such,
with a code a caller can branch on. Genuine faults keep answering 500 and keep being logged.

**`requires_item` means at least one line.** An item-mandatory type submitted with no lines is
rejected in the same place and with the same shape as one submitted with an item-less line.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `platform-foundation`: DTO validation extends to a body that arrives as a top-level array, and a
  failure raised below the DTO layer is not reported as a server fault.
- `document-engine`: an item-mandatory type requires at least one line, closing the vacuous case.

## Impact

- `back/src/modules/document/document.controller.ts` — the two array bodies.
- `back/src/common/errors/coded-exception.filter.ts` — one more recognised shape; the existing
  passthrough and 500 branches unchanged.
- `back/src/modules/document/document-submit.service.ts` — the `requires_item` gate.
- No schema change, no migration, no client change. The web app reads `message` and nothing else,
  and must not notice this.

## Who this answers

| party | today | after |
| --- | --- | --- |
| an integration PUTing a line with no `lineAmount` | 500 `INTERNAL_ERROR` — retry or escalate | 400 naming the field |
| an integration PUTing a misspelt field name | 204, silently ignored | 400 naming the field |
| whoever is on call | a logged stack for someone else's typo | nothing logged; it was never our fault |
| whoever submits an empty goods issue | it completes, and issues nothing | rejected at submit, document stays DRAFT |
| whoever reads `platform-foundation` | "every request DTO is validated" — with two exceptions nothing records | true as written |

## What This Change Does NOT Do

- **Does not add or change a single validation rule.** Every decorator stays as it is; two endpoints
  start running the ones they already had.
- **Does not audit the rest of the API for this shape.** Two endpoints take a bare array body and
  both are fixed here; whether other unvalidated body shapes exist has not been surveyed.
- **Does not change what a genuine fault answers.** A real server error is still 500, still logged,
  still opaque to the caller.
- **Does not require a document to have lines in general.** Only an item-mandatory type is affected;
  a type that asks for no items may still be submitted without any.
- **Does not touch the client.** The response body keeps its shape, and `utils/apiError.ts` reads
  `message` exactly as before.

## Why

`@erp/shared` is the single source of truth for validation schemas, consumed at runtime by the
backend (`ZodValidationPipe`, `companyCreateSchema`, …) and the frontend (`zodResolver` in ~10 form
views). It and the backend are on **Zod 3.25**, and PrimeVue's form resolver
(`@primeuix/forms@0.1.0`) is typed for **Zod 3** (`import { Schema, ParseParams } from 'zod'`). The
front-end, however, declares a stray direct `zod: ^4.4.3` even though it has **no direct Zod usage** —
it only consumes shared schemas through `zodResolver`. The result: `vue-tsc` is red across every
`zodResolver(...)` form (the schema's Zod-3 shape doesn't satisfy the Zod-4 `$ZodTypeInternals` the
resolver's type now resolves to), so the production type-check gate is broken — purely a type-level
version drift; both Zod 3 and 4 schemas work at runtime through the version-agnostic resolver.

## What Changes

- **Pin the front-end to Zod 3**, matching `@erp/shared`, the backend, and the PrimeVue form
  resolver: `front-end` `zod: ^4.4.3` → the same `^3.25.x` the rest of the repo uses, then reinstall.
- **Align all three packages on one Zod major** (`shared`, `back`, `front-end`) so the shared schemas
  type-check identically everywhere and future drift is obvious.
- **Restore the type-check gate:** `vue-tsc -b` (and `pnpm build`) pass again, so frontend changes are
  type-checked before merge.

This is a dependency/config alignment only — no application code, schema rules, or runtime behaviour
change. Bumping the other way (everything to Zod 4) is deliberately not chosen: it would also require
upgrading PrimeVue's forms package to a Zod-4 resolver, a much larger surface for no functional gain.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
<!-- None — tooling/dependency alignment only; no capability behaviour changes. -->

## Impact

- **Dependencies:** `front-end/package.json` `zod` → `^3.25.76` (match `@erp/shared`); lockfile
  refreshed via `pnpm install`. No backend or shared version change (already Zod 3).
- **Tooling:** `vue-tsc -b` / `pnpm build` move from failing to passing; CI's frontend type-check gate
  works again.
- **Risk surface:** the form `zodResolver` is runtime version-agnostic (it calls `schema.parse` and
  reads `issues || errors`), so no runtime behaviour changes; the change is verified by the type-check
  going green and the existing frontend unit tests + `vite build` still passing.
- **Invariants:** none affected — no schema rules, money handling, or API contracts change; the
  client/server shared-schema single-source-of-truth is preserved (now genuinely on one Zod major).

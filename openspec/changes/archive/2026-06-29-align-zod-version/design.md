## Context

`@erp/shared` (the validation single source of truth) and the backend are on Zod `3.25.76`. PrimeVue's
form resolver, `@primeuix/forms@0.1.0` (re-exported by `@primevue/forms@4.5.5`), is **typed for Zod 3**
— its `zodResolver` signature is `<T extends Schema<any,any>>(schema: T, schemaOptions?: ParseParams,
…)`, and `ParseParams` is a Zod-3 type. The frontend nevertheless declares a direct `zod: ^4.4.3`,
despite having **no direct `import … from 'zod'`** anywhere in `src` — it only consumes shared schemas
through `zodResolver`. So when `vue-tsc` compiles a view, `zod` resolves to v4, the shared schemas
(Zod-3 runtime objects) are typed against v4's `ZodType`, and the resolver's expected
`$ZodTypeInternals` are absent → a type error on every `zodResolver(...)` call. At runtime nothing is
wrong: the resolver just calls `schema.parse`/`parseAsync` and reads `issues || errors`, which both Zod
3 and 4 schemas provide.

## Goals / Non-Goals

**Goals:**
- One Zod major across `shared`, `back`, and `front-end`.
- `vue-tsc -b` / `pnpm build` green again (restore the frontend type-check gate).
- No runtime/behaviour change; existing tests + `vite build` keep passing.

**Non-Goals:**
- Not upgrading everything to Zod 4 (that needs a Zod-4 PrimeVue forms resolver — a much bigger, no-gain
  change). Not rewriting any schema rules.

## Decisions

**1. Pin the frontend to Zod 3, not bump the repo to Zod 4.** The resolver and the shared schemas are
Zod 3; the frontend's `zod: ^4.4.3` is unused drift. Set `front-end` `zod` to the same `^3.25.x` the
shared package uses and reinstall. Chosen over a repo-wide Zod-4 bump because the installed PrimeVue
forms resolver is Zod-3-typed — bumping to 4 would force a PrimeVue forms upgrade for zero functional
benefit. Verified safe by: the frontend has no direct Zod usage, and the resolver is runtime
version-agnostic.

**2. Verify by the type-check, not just install.** The acceptance signal is `vue-tsc -b` going from red
to green across the `zodResolver` views. If any residual error remains after the pin (e.g. a Zod-3 API
the schemas don't actually use, or a stale lockfile), fix it under this change rather than declaring
done on install alone.

## Risks / Trade-offs

- [Lockfile / hoisting leaves two Zod copies] → After editing `front-end/package.json`, run the
  workspace install so the lockfile pins one Zod 3 version reachable by the frontend; confirm
  `node -e "require('zod/package.json').version"` resolves to 3.x from the frontend.
- [A frontend dependency silently needs Zod 4] → None found (no direct Zod usage; PrimeVue forms is
  Zod-3); if `vite build` or unit tests surface one, address it in this change.
- [Re-drift later] → The added platform-foundation requirement makes "one Zod major across consumers"
  an explicit, checkable invariant.

## Migration Plan

Edit `front-end/package.json` `zod` → `^3.25.76`; run the workspace package install to refresh the
lockfile; run `vue-tsc -b`, the frontend unit tests, and `vite build`. No code, schema, or data change;
rollback is reverting the version + reinstalling.

## Open Questions

- Exact `^3.25.x` to pin — match whatever `@erp/shared` resolves to today (`3.25.76`) to guarantee a
  single resolved version; confirm during apply.

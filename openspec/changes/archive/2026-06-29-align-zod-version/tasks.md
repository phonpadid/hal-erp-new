## 1. Pin the frontend to Zod 3

- [x] 1.1 Set `front-end/package.json` `zod` to `^3.25.76` (the version `@erp/shared` resolves to), matching the backend and the PrimeVue forms resolver.
- [x] 1.2 Refresh the workspace lockfile (package install) so the frontend resolves a single Zod 3.x; confirm `front-end` resolves `zod` to 3.x (e.g. `node -e "require('zod/package.json').version"`).

## 2. Verify the type-check gate is restored

- [x] 2.1 Run `vue-tsc -b` (or `pnpm build`) in `front-end` and confirm the `zodResolver(...)` view errors are gone (green). Fix any residual Zod-3 API mismatch in the shared schemas under this change.
- [x] 2.2 Run the frontend unit tests (`vitest`) and `vite build`; confirm both still pass (no runtime/behaviour change).
- [x] 2.3 Confirm the backend still builds and its `@erp/shared`-dependent tests pass (backend already Zod 3 — sanity check only).

## 3. Lock in the invariant

- [x] 3.1 Confirm `shared`, `back`, and `front-end` now resolve the same Zod major; note it so future drift is caught (the platform-foundation requirement now states this).

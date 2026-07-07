## Context

The frontend (`front-end/`, Vue 3 + PrimeVue 4 + Pinia + vue-i18n) exposes ~30 routed
views via `src/router/index.ts`. Static signal today is thin: `vue-tsc -b` reports 7
errors (all the `<EmptyState>` missing-`title` pattern in `views/reports/*`), and all 164
Vitest tests pass — but the passing suite covers stores/components, not whole-view
rendering, so a view can be broken at runtime and still be green. There is no shared
definition of what "a working page" means, so an audit has nothing to check against. This
change adds that bar (`web-ui-quality` spec) and walks every page against it.

## Goals / Non-Goals

**Goals:**
- A repeatable, per-page audit covering all routed views, with results recorded in a
  matrix in `tasks.md`.
- A green `vue-tsc -b` and one smoke-render test per view, as the standing regression bar.
- Fix every defect the audit surfaces, beginning with the known `EmptyState` bug.

**Non-Goals:**
- No backend, DBML, migration, or API contract changes.
- No redesign, restyle, or new features — behavior-preserving fixes only.
- Not full e2e coverage of every business flow; smoke render + targeted state assertions,
  with Playwright reserved for a few critical happy paths if time allows.

## Decisions

- **Vitest component smoke tests over full Playwright e2e.** Mounting each view with mocked
  Pinia store, router, and i18n gives ~30 fast, deterministic guards that catch render
  throws, missing required props, and broken empty/error branches. *Alternative:* Playwright
  against a running stack — higher fidelity but slow, flaky, and needs backend fixtures;
  deferred to a few critical paths only.
- **Audit matrix lives in `tasks.md`, one row per view × the six `web-ui-quality` criteria.**
  Makes coverage and gaps explicit and reviewable. *Alternative:* a free-form findings doc —
  rejected as not checkable.
- **Fix the `EmptyState` contract at the call sites, not by loosening the component.** Make
  `title` optional would hide the bug class the spec exists to prevent; instead pass a real
  `title` (+ existing `message`) at each of the 7 call sites. *Alternative:* default the
  title inside `EmptyState` — rejected; it would silently mask missing context.
- **`vue-tsc -b` is the type gate.** It already catches the prop-contract violations; wire
  it as a required check rather than inventing a new lint rule.
- **Walk views in router order, grouped by domain** (documents → approvals → payments →
  budgets → quota → reports → notifications → master/admin → org-admin) so related stores
  are exercised together and shared bugs are found once.

## Risks / Trade-offs

- **Smoke tests with heavy mocking can pass while real wiring is broken** → keep mocks thin
  (real component, mocked data layer only) and assert the loading/empty/error branch each
  view actually renders, not just "did not throw".
- **The audit may surface more bugs than expected, expanding scope** → record every finding
  in the matrix; triage into "fix in this change" vs. "follow-up proposal" so the change
  stays shippable.
- **`vue-tsc` as a hard gate may block unrelated work mid-audit** → fix the 7 known errors
  first so the gate is green before tightening CI.
- **i18n completeness check across `en`/`la` locales is easy to do superficially** → assert
  keys used by audited views exist in every locale file, not just the default.

## Migration Plan

1. Fix the 7 `vue-tsc` errors (EmptyState `title`) so the type gate is green.
2. Add smoke-render tests per view, landing them alongside the fixes for each domain group.
3. Record audit findings in the `tasks.md` matrix as each page is walked; fix in-scope
   defects, open follow-ups for the rest.
4. No deploy/runtime migration — frontend-only, behavior-preserving. Rollback is a plain
   revert of the frontend changes; no data or API surface is touched.

## Open Questions

- Should the i18n key-resolution check be enforced by a test/CI script, or remain a manual
  audit step for this change? (Leaning: a small test that diffs key sets across locales.)
- Which 2–3 flows, if any, warrant a Playwright happy-path beyond smoke tests
  (e.g. create-document → submit, budget transfer)?

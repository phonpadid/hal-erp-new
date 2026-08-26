## 1. Read the configuration a company has

- [x] 1.1 `back/scripts/golive/inspect.ts` — one read-only pass returning, per company: active types
      with no active `dept_doc_type`; mappings whose `form_template.status` is not `PUBLISHED`;
      workflows reachable from a mapping whose every step targets `approver_user_id`; currencies on
      existing `document` rows for which `ExchangeRateService` resolves no rate; active types whose
      `post_action` puts content on `budget_movement`/`journal_voucher` with no `authoring_route`.
- [x] 1.2 Unit spec per finding, each built from a fixture in exactly that state — and a company in
      none of them reports nothing.
- [x] 1.3 Assert the pass writes nothing: run it against a seeded database and compare row counts
      for every table it reads.

## 2. Ask the question

- [x] 2.1 `back/scripts/golive-check.ts` + `golive:check` script, shaped like
      `permissions-check.ts`: report, name the fix for each finding, exit non-zero when anything is
      reported.
- [x] 2.2 `--company <code>` to narrow; default is every company.
- [x] 2.3 `--template <path>` emits the config file pre-populated with the subjects found and blank
      slots for the decisions.
- [x] 2.4 Run it against the customer's database and keep the output — it is the question list for
      the customer, and the baseline this change is measured against. Kept in
      `docs/golive-check-2026-08-26.md`. Run against `demo_erp`, not `real_server`: that copy
      carries the `E2E-SBX` sandbox, which maps all eleven `REC*` types, so they surface as eleven
      draft FORMS rather than eleven unmapped types. The doc says so and says to re-run it against
      `real_server`, which the command is safe to do — it is read-only, asserted by row count.

## 3. Record the answers

- [x] 3.1 `back/scripts/golive/config.ts` — the file's Zod schema and reader. Money and rates are
      strings. Fails with the path of the offending key, not a stack trace.
- [x] 3.2 Resolver: turn every name in the file (company code, dept code, type code, template
      version, workflow name, currency code) into an entity, collecting ALL unknown references
      before failing, so one run names every problem rather than the first.
- [x] 3.3 `back/scripts/golive-apply.ts` + `golive:apply` — reconcile inside a Nest context, through
      `DeptDocTypeService`, `FormTemplateService`, `WorkflowConfigService`, `ExchangeRateService`
      and `DocumentTypeService`; one transaction per company.
- [x] 3.4 Types the file omits are left untouched and listed in the output.
- [x] 3.5 Unit spec: applying a file makes an unmapped type raisable, and `inspect` stops reporting
      it.
- [x] 3.6 Unit spec: applying twice writes nothing the second time (compare row counts and
      `updated`-style columns).
- [x] 3.7 Unit spec: an unknown department fails before any write — assert the mapping table is
      untouched afterwards.
- [x] 3.8 Unit spec: a cross-company mapping is refused, matching what the configuration screen
      refuses.
- [x] 3.9 Unit spec: a `DRAFT` template named by the file ends `PUBLISHED`, and stays so on a second
      apply.

## 4. Make the silent state visible at deploy

- [x] 4.1 `boot-check.ts` reports the count of active types no department maps, without failing.
- [x] 4.2 Unit spec: a database with unmapped types still exits zero and prints the count.

## 5. Close the loop

- [x] 5.1 `pnpm --filter back test` (2030 passed, 36 skipped) and `boot:check` pass. Also added
      `typecheck:scripts` and a CI step for it: `tsconfig.build.json` excludes `scripts/`, so
      nothing typechecked these files until ts-node compiled them at run time — which is how
      a `FilterQuery` error in the applier reached a live invocation.
- [~] 5.2 Apply a filled-in file to a scratch copy of the customer's database, then run the whole
      `back/e2e` suite against it. **Half done, and the other half is blocked on 6.1.** The round
      trip was exercised against `demo_erp`: `--dry-run`, apply, re-apply (silent), and the check
      dropping from 14 findings to 3. But the file that was applied publishes eleven forms and
      nothing more — it invents no routing, because which department raises each `REC*` type is
      exactly what nobody has told us. The e2e suite therefore still builds its own sandbox, and
      will keep doing so until 6.1 is answered. Two real defects came out of the run anyway: a
      relation the resolver left unpopulated, which broke idempotence in a fresh process while the
      unit spec passed on a warm identity map, and a `FilterQuery` type error `nest build` never
      sees because it excludes `scripts/`.
- [x] 5.3 Fold the deltas into `openspec/specs/go-live-configuration/spec.md` (new) and
      `openspec/specs/platform-foundation/spec.md`.

## 6. Blocked on the customer — not this change's to close

> Archived 2026-08-26 with these open, deliberately. They are decisions nobody has recorded, not
> work left undone, and the commands that ask for them and record them are built and shipped.
> Carried forward to `docs/open-questions-2026-08-26.md` so archiving does not bury them.


- [ ] 6.1 Which department raises each of the eleven `REC*` types, and under which workflow.
- [ ] 6.2 Whether approval chains should target roles, and which roles — the existing four do not
      look like a fit.
- [ ] 6.3 Whether USD documents will continue to be raised, and if so the rate source and whether a
      `BUDGET_RATE` is wanted.

# Tasks — No flag without its prerequisite

## 1. The three rules

- [x] 1.1 **Payee needs vendor.** An active type with `requires_payee` and without `requires_vendor`
      is refused. The submit check demands the payee belong to `document.vendor`, and the client's
      picker loads from the vendor — without it the field can never be filled.
- [x] 1.2 **Stock post-action needs a warehouse.** An active type whose `post_action` is in
      `STOCK_POST_ACTIONS` and whose `requires_warehouse` is false is refused. Use that shared
      constant, not a list of type codes (invariant 7) and not `RESERVING_ACTIONS` — `ADJUST_STOCK`
      reserves nothing but still has to say which shelf it corrects.
- [x] 1.3 **Accrual needs a source.** An active type with `accrues_on_approval` and neither
      `requires_budget` nor `requires_vendor` is refused: the accrual reads `ACTUAL` budget rows,
      from the document's own when there is no vendor and from the charged ancestor when there is,
      and this type has neither.
- [x] 1.4 Each refusal names the **missing** flag, not the present one (D5) — either flag could be
      the one the administrator meant, and adding the prerequisite is the more common fix.

## 2. Where they live

- [x] 2.1 `DocumentTypeService`, beside `assertNoOtherVoucherType`, `requireCategory` and the two
      reservation rules from `reserve-only-what-something-can-settle`. Same file, same question.
- [x] 2.2 Applied to the **resulting state**, not the dto, so removing a prerequisite is refused
      like never setting one. The reservation rules already do this; match them.
- [x] 2.3 Gate on `isActive`, as every other rule in that file does.
- [x] 2.4 In `create`, run them **before** `em.create` — MikroORM persists on create, and a rejected
      entity left in the unit of work gets written by the next flush. `reserve-only-what-something-can-settle`
      hit exactly that (its D6a) and moved its checks ahead of the entity; these go in the same place.

## 3. Tests

- [x] 3.1 Payee without vendor refused; payee **with** vendor accepted.
      → `flag-prerequisites.spec.ts` — refused without a vendor, accepted with one.
- [x] 3.2 Each stock post-action (`ISSUE_STOCK`, `ADJUST_STOCK`, `TRANSFER_STOCK`) without a
      warehouse refused; a non-stock post-action without one accepted. `ADJUST_STOCK` is the case a
      `RESERVING_ACTIONS`-shaped rule would wrongly let through, so it earns its own assertion.
      → `it.each` over `STOCK_POST_ACTIONS`, refused without and accepted with, plus a non-stock action left alone.
- [x] 3.3 Accruing with neither budget nor vendor refused; accruing **with budget** accepted;
      accruing **with vendor** accepted. The last two are what stop this rule over-refusing the two
      shapes the reference configuration actually ships.
      → All three: neither source refused, the CLAIM shape (own budget + settling action) accepted, the DISB shape (vendor, no budget) accepted.
- [x] 3.4 Removing a prerequisite by update is refused (the both-directions case).
      → Clearing `requires_vendor` on a payee-requiring type is refused, and the row is unchanged afterwards.
- [x] 3.5 An inactive type may hold any of the three unmet; activating it is refused.
      → An inactive type holds an unmet prerequisite freely; activating it is refused.
- [x] 3.6 Every refusal message names the missing flag.
      → Each refusal asserted against the missing flag by name.
- [x] 3.7 The seeded configuration satisfies all three — the reference configuration is what these
      rules were written against, and a rule that refuses it is wrong.
      → Asserted in `seed.spec.ts` over EVERY active seeded type, not the three that prompted the rules. The seed passes; the only row in the running database that violates anything is `XFER_NOWH`, which I created to prove the stock case.
- [x] 3.8 Each new test must fail with its feature removed. Check it, and record what was mutated.
      Restore from a scratch copy, never `git checkout` — that destroyed a day of uncommitted work
      earlier in this session.
      → Six mutations, all caught: each of the three rules removed (4/4/2 failures); the stock rule narrowed to the reserving set so `ADJUST_STOCK` slips through (2); `isActive` ignored (1); `update` no longer re-checking the resulting state (2). Restored from a scratch copy.

## 4. Verification

- [x] 4.1 back `npx vitest run` — **one suite at a time**, nothing else running. Two concurrent
      suites share the test database and both call `dropSchema`/`refreshDatabase`; the tell is the
      skip count jumping from 36 and fast tests taking tens of seconds. Expect the known
      date-dependent attendance-correction failure. `tsc -p tsconfig.build.json --noEmit`.
      → 1630 passed / 1 failed — the known date-dependent attendance-correction test, unrelated. Skips at 36, which is how a clean run is recognised. `tsc -p tsconfig.build.json --noEmit` clean. Four existing tests in `approval-accrual.spec.ts` needed updating first: they asserted that accrual and payee may be combined — which these rules do not contest — but with payloads so minimal they carried no vendor, while the shipped shape (DISB) has one.
- [x] 4.2 front `npm run typecheck` and `npx vitest run` — **after** the backend finishes, for the
      same reason.
      → 854 passed (96 files), `vue-tsc -b` clean. No front-end change was needed: these rules are server-side only.
- [x] 4.3 `openspec validate --all`.
      → 72 passed / 0 failed.
- [x] 4.4 On the running app, retry the experiment that produced the 500: a `TRANSFER_STOCK` type
      with `requires_warehouse = false` must now be refused when it is saved, rather than accepted
      and failing at submit.
      → On the running app, all four bad configurations refused at the moment of saving with messages naming what to add — including `PROBE_XFER`, the exact `TRANSFER_STOCK`-without-warehouse shape that produced a **500 at submit** earlier today and is now a **400 at save**. The correct shape (`TRANSFER_STOCK` + `requires_warehouse`) still saved with 201. All probe types removed afterwards.

## 5. Scope deliberately left out

- [x] 5.1 **An accruing type whose vendor chain reaches no reserving predecessor.** Also finds no
      `ACTUAL` rows, but that depends on the pairing graph rather than on this row (D3). It belongs
      with the `document_type_ref` change.
      → Held — an accruing type whose vendor chain reaches no reserving predecessor is still accepted; it belongs with the pairing-graph change.
- [x] 5.2 **`ValidationError` answering 500 rather than 400.** The stock case was one of its two
      known causes; closing this hole removes that cause but not the escape. Fault handling, not
      configuration.
      → Held — the `ValidationError` 500 escape is untouched. This change removes one of its two known causes, not the escape.
- [x] 5.3 **`requires_item` on a stock type.** Without it `demandFor` throws a clean 400 naming the
      line, so it degrades gracefully and is left alone (design open question).
      → Held — `requires_item` on a stock type still degrades to a clean 400 from `demandFor`.
- [x] 5.4 **`requires_item` with zero lines still submits.** A vacuous-truth hole recorded during
      earlier testing; a different class from anything here.
      → Held — the zero-lines vacuous-truth hole is untouched.
- [x] 5.5 **Stored types are not retro-validated**, including `XFER_NOWH` on the test database,
      which was created to prove the stock case and is left in place.
      → Held — no stored type was re-validated. `XFER_NOWH` is still there and is now the only row in the database that would fail these rules.
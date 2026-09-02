# Tasks — Reserve only what something can settle

## 1. Name the settling action once

- [x] 1.1 Export a settling-action grouping from `shared`, beside `MOVEMENT_POST_ACTIONS` and
      `RESERVING_ACTIONS`. Only `CUT_BUDGET` settles a budget reservation: it is the sole
      dispatch that reaches `cutBudget`, the sole caller of `BudgetLedgerService.settle`, the sole
      writer of `ACTUAL`.
- [x] 1.2 Do NOT reuse `RESERVING_ACTIONS` (D3) — it means *reserves stock*, a different resource
      with a different lifecycle. Two lists that share the word "reserve" are not the same list.

## 2. Reachability over the pairing graph

- [x] 2.1 A company-scoped walk from a document type over `document_type_ref`, answering: does any
      path reach an active type whose post-action settles budget?
- [x] 2.2 Build on `successorTypesFor` — it already returns the paired successors by predecessor id
      and deliberately leaves the active-state decision to the caller.
- [x] 2.3 Every pairing counts, `auto_create` or not (D4): a manual create-from is still a route a
      settlement arrives by, and it is how a `DISB` is actually raised against a `PO`.
- [x] 2.4 Skip inactive types — a type nobody can raise is not a path (D5).
- [x] 2.5 Cycle-safe. Nothing forbids `A → B → A` in the table, and a naive recursion would not
      return. There is a scenario for this.

## 3. Enforce it on the three writes that can break the graph

- [x] 3.1 **Revised during implementation (D6).** Reachability CANNOT bind at
      `DocumentTypeService.create`: a pairing names two existing types, so a new type has no edges
      and the `PROC` shape — reserves, settled downstream — would be unconfigurable, refused at
      creation and unreachable after. It binds at `DeptDocTypeService.create` instead, the point at
      which a type becomes raisable and so the first point a reservation is possible. `update` runs
      both rules on **the resulting state, not the dto**, the discipline `assertNoOtherVoucherType`
      states two methods away.
- [x] 3.2 Gate on `isActive`, as `assertNoOtherVoucherType` does. An inactive dead-end type is
      allowed; activating it is where the rule bites. Also found: `create` built the entity before
      validating, so a rejected type stayed in the shared EM's unit of work and a later flush wrote
      it — the checks moved ahead of `em.create` (D6a).
- [x] 3.3 `RefChainService.removePairing` — refuse when the removal would leave an active reserving
      type with no remaining path.
- [x] 3.4 Deactivating a type — refuse when it is the last settlement on somebody's only path. Same
      shape as `budgetsStrandedByDeactivating`, which already refuses to deactivate a control point
      that would strand a budget.
- [x] 3.5 Every rejection names the reserving type left without a settlement (D-risk). An
      administrator retiring a type and being told only "no" will read the system as obstinate — the
      same reason the disabled cards in `offer-only-the-doors-you-can-open` name their permission.

## 4. The accrual-timing rule

- [x] 4.1 An active type with `accrues_on_approval` **and** `requires_budget` must settle through
      its own `post_action` — a downstream settlement does not satisfy it (D1a): the accrual runs at
      this document's approval, before any successor exists, finds no `ACTUAL`, and records a
      terminal outcome.
- [x] 4.2 One direction only. A type that settles without accruing stays permitted — `PR` is one and
      is coherent, booking nothing until payment.
- [x] 4.3 The two rules overlap; their messages must say different things, or the second reads as
      the first repeating itself.

## 5. The reference configuration

- [x] 5.1 `CLAIM` gets `post_action = CUT_BUDGET` in the seed, joining `PR` in the self-reserving,
      self-settling shape.
- [x] 5.2 Confirm the seed satisfies both new rules after the change — it is the configuration the
      rules were written against, and it currently violates them.
- [x] 5.3 A migration is NOT in scope for existing databases (D7). The rules bind on write; a stored
      configuration nobody touches is never re-examined. Say so rather than leave it implied.

## 6. Tests

- [x] 6.1 Reachability: settles itself → accepted; settlement two hops away → accepted; no path →
      Reachability: settles itself, two hops, no path, path through an inactive type, and a cycle — nine cases in `reservation-settlement-config.spec.ts`.
- [x] 6.2 Active-state binding: an inactive dead-end type is accepted, and activating it is refused.
      Active-state binding covered; an inactive dead-end updates freely and refuses on activation.
- [x] 6.3 Removing the last pairing on a path is refused and names the stranded type; deactivating
      Both stranding directions covered, each asserting the stranded type is NAMED, and the pairing case also asserts the deletion rolled back.
- [x] 6.4 Accrual timing: accruing + self-reserving without its own settler → refused, **including
      Covered, including the paired-successor case reachability would wave through.
- [x] 6.5 Settling without accruing stays accepted.
      Covered.
- [x] 6.6 End-to-end on the corrected seed: a `CLAIM` submitted, approved, and then observably
      Two seed tests: every active reserving type can be settled (the shape, not the one instance), and CLAIM carries all three flags. End-to-end walked by hand instead of scripted — see 7.4. **Why this shipped broken: `approval-accrual.spec.ts` builds its own types with `postAction: CUT_BUDGET` hardcoded, so the accrual behaviour was thoroughly tested and the configuration that ships never was.**
- [x] 6.7 Each new test must fail with its feature removed. Check it, and record what was mutated —
      Six mutations, all caught: mapping gate removed (3 fail), walk ignores `isActive` (2), walk stops at direct pairings (2), accrual-timing rule removed (2), seed reverts CLAIM (2), stranding check on pairing removal removed (1). Restored from a scratch copy, not `git checkout`.

## 7. Verification

- [x] 7.1 back `npx vitest run`; `tsc -p tsconfig.build.json --noEmit` (**not** `nest build` while
      back 1598 passed / 1 failed — the known date-dependent attendance correction. The journal-voucher delegation failure cleared itself when the date rolled over. `tsc -p tsconfig.build.json --noEmit` clean.
- [x] 7.2 front `npm run typecheck` (**not** bare `npx vue-tsc --noEmit`, which checks nothing here)
      front 842 passed (94 files), `vue-tsc -b` clean.
- [x] 7.3 `openspec validate --all`.
      valid, and `--all` reports 72 passed / 0 failed with this change included.
- [x] 7.4 Walk a compensation claim through the UI as `requester` → `approver` and confirm the
      Raised CLAIM-HAL-2026-0002 through the wizard and approved it. All three outcomes observed: `ACTUAL 35,000` beside its RESERVE; `APPROVAL_ACCRUAL` **POSTED** (not SKIPPED) with `5000 Office Supplies Expense` debited 35,000 and `2300 Claims Payable` credited 35,000; and the row now reads "ຍັງບໍ່ໄດ້ອັບໂຫລດສະລິບເງິນໂອນ" in the transfer-slip column that started this. The type config was applied to the running test database by hand rather than re-seeding, which would have destroyed the documents kept for inspection.

## 8. What this change knowingly leaves broken

- [x] 8.1 `CLAIM-HAL-2026-0001` on the `erp_uitest` database stays as it is: `COMPLETED`, holding
      50,000 of Office Supplies as an unresolvable `RESERVE`, with a terminal `SKIPPED` accrual and
      no journal entry. `budget_txn` is append-only and no endpoint settles a document whose
      post-action has already run.
- [x] 8.2 **Observed while verifying, and not what the proposal first assumed.** Correcting the type
      makes that old claim *appear in the payment queue*: `owedDocuments` reads the type's
      `post_action`, not the document's own history, so it now answers the `CUT_BUDGET` clause.
      Its budget is still stranded and its books still empty — only its visibility changed. So it is
      now payable-looking and unrecognised, which is a different wrongness from the one that was
      described, and both proposal and this list say so rather than leaving the first description
      standing.
- [x] 8.3 Left deliberately, as known-bad demo data, so that anyone reading a `committed` of 100,000
      on that budget knows 50,000 of it is this document and not work in flight. Correcting it means
      choosing an accounting statement — a corrective release is not a budget increase — and that
      belongs to whoever owns the books.

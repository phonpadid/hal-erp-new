## 1. The door

- [x] 1.1 `back/src/modules/gl/gl-posting.service.ts` — `SOURCE_MANUAL = 'MANUAL_JV'` and
      `SOURCE_REVERSAL = 'REVERSAL'` beside the existing source types, exported. **No posting path
      changes**: this task adds two constants and nothing else, and any diff in the four posting
      methods is a mistake.
- [x] 1.2 `back/src/modules/gl/permissions.ts` — `GL_JV_POST`. One code for both posting and
      reversing: a reversal is a voucher whose lines were computed for you, and splitting them would
      suggest a difference in privilege that is not there.
- [x] 1.3 `back/src/modules/gl/dto/journal-voucher.dto.ts` — the voucher (`entryDate`, `memo`,
      optional `id`, lines) and its lines (`accountCode`, `debit`, `credit` as decimal STRINGS,
      never numbers), plus the reversal DTO (`entryDate` optional). Validate: at least two lines,
      each with exactly one non-zero side. Money as strings on both sides of the wire.

## 2. Posting a voucher

- [x] 2.1 `back/src/modules/gl/journal-voucher.service.ts` — `post(dto)`: resolve every line's
      account through `AccountService.resolvePostable` (which already rejects missing, inactive,
      non-postable and other companies' accounts), build the draft, and hand it to `createEntry`.
- [x] 2.2 Add **no rules of its own**. Balance, company day, closed-period refusal and append-only
      all come from `createEntry`; the account rule comes from the resolver. If this service starts
      validating something those two already validate, the duplicate is the bug (design D4).
- [x] 2.3 `sourceId` is the caller's when given and generated when not, and the docstring says why:
      the existing unique index makes a retry idempotent, the same contract `document.source_id`
      gives external callers. A caller who supplies nothing gets no protection, which is the honest
      default for a request that did not ask for it (design D2).

      **The design under-specified this and a test caught it.** D2 said the unique index "does the
      work", which is false: a retry hitting the index gets a duplicate-key ERROR, not the entry it
      already has. Idempotency is a lookup — `if (existing) return existing` — the same shape every
      posting path uses. The index remains the backstop, not the mechanism.
- [x] 2.4 Confirm — by reading, and say so here — that the service writes no `budget_txn` and
      records no `gl_posting_attempt` row. Both omissions are deliberate: the budget is a separate
      book, and the posting queue is for work the system owes itself, which the period close reads
      (design D4).

      **Confirmed by reading and by test 5.6**, which asserts both counts are unchanged across a
      voucher — an absence nobody asserts is one that comes back.

## 3. Reversing an entry

- [x] 3.1 `reverse(entryId, entryDate?)` — load the entry with its lines, company-scoped; write a
      new entry with each line's debit and credit exchanged; key it `(SOURCE_REVERSAL, entryId)`.
- [x] 3.2 The "once only" rule is checked before writing and backed by the unique index on
      `(company, source_type, source_id)`. The task originally said the index alone would do it;
      that gives a caller a duplicate-key error instead of an explanation. The check is for the
      message, the constraint is for the race.
- [x] 3.3 The reversal's date defaults to **today**, not to the original's. The original's period is
      frequently closed — often the reason it is being reversed — and dating a correction into a
      reported month would either be refused or restate figures somebody has acted on (design D3).

      "Today" is `new Date()` handed straight to `createEntry`, NOT a date string derived here.
      Deriving one would have used `toISOString()` and reintroduced the UTC-day bug this posting
      engine was corrected for two changes ago — which is what the first draft of this method did.
- [x] 3.4 Any entry is reversible, not only a manual one. A wrong automatic posting is the likelier
      case; a check restricting this to `MANUAL_JV` would close the hole this change exists to open.

## 4. Endpoints

- [x] 4.1 `journal.controller.ts` — `POST /journal/vouchers` and `POST /journal/:id/reverse`, both
      `GL_JV_POST`, both company-scoped.
- [x] 4.2 `general-ledger.module.ts` — register the service.

## 5. Tests

- [x] 5.1 A balanced voucher posts: the entry exists with its lines, `source_type` marks it manual,
      and `created_by` is the poster.

      **`created_by` was a claim, not a fact.** `createEntry` never set it, so no entry in the
      system had an author — while the proposal cited attribution as a control standing in for the
      missing approval route. `EntryDraft` now carries an optional `createdById`, the voucher and
      reversal paths set it from the request, and the four engine paths deliberately do not: a
      machine posting has no author, and that contrast is what makes a manual one's author mean
      something. A thirteenth case asserts the engine entry stays unattributed.
- [x] 5.2 An unbalanced voucher is refused and writes neither entry nor lines — through the voucher
      path, since `createEntry`'s own test reaches the same guard directly and this one proves the
      door is wired to it.
- [x] 5.3 A line naming an inactive, non-postable or another company's account is rejected naming
      that account.
- [x] 5.4 A voucher dated inside a closed accounting period is refused naming the period. This is
      the case that proves a voucher is subject to the same ledger as an automatic posting, rather
      than a way around it.
- [x] 5.5 Idempotency: posting twice with the same caller-supplied id yields exactly one entry;
      posting twice without one yields two.
- [x] 5.6 A voucher writes no `budget_txn` and no `gl_posting_attempt` row. Assert both absences —
      they are decisions, and an absence nobody asserts is an absence that comes back.
- [x] 5.7 Reversal: the sides are exchanged, the two entries net to zero per account, and the
      original is unchanged.
- [x] 5.8 An **automatic** posting can be reversed — build a payment settlement, reverse it. The
      likelier real case, and the one a careless restriction would have blocked.
- [x] 5.9 A second reversal of the same entry is rejected, and exactly one reversal exists.
- [x] 5.10 A reversal of an entry dated in a closed period is accepted when dated today, which is
      the default — the correction lands where it was decided.
- [x] 5.11 Existing suites stay green — 1366 backend tests today. Nothing in this change touches a
      posting path, so every entry the engine writes must be byte-for-byte what it wrote before.

      **Result:** `npx vitest run` — **1379 passed, 36 skipped, 0 failed** (132 files), up from 1366
      by the thirteen cases added here. `nest build` clean. `git diff --stat` on
      `gl-posting.service.ts` is **+7 lines, all of them the two new source-type constants** — no
      posting path was touched, which task 1.1 named as the thing to verify rather than assume.

## Context

Three places take an actual exchange rate, and one place spends it:

- `payment-attachment.service.ts` — `attach()` stores `actualRate` on a `payment_attachment` and
  restates the document through `DocumentRateService.restate`; `stateRate()` restates without
  re-attaching evidence. The only check today is `Money.compare(actualRate, '0') <= 0`.
- `payment.service.ts` — `record()` repeats the same positivity check on its own input, then resolves
  `const actualRate = input.actualRate ?? rateOnSlip` and computes
  `baseActual = round(baseLocked × actualRate / lockedRate)`, from which `fx_delta` and the journal
  entry follow.

The September failure went through the fourth of these. The rate was stated on the slip while the
document was foreign-currency, the document's currency and rate were corrected afterwards, and
`record()` adopted the stale slip figure without anyone restating anything. A check placed only on the
statement paths would not have caught it.

`document.currency` is nullable and a null means the base currency — `document-submit.service.ts`
already reads it that way (`document.currency?.code ?? baseCode`), so the new rule treats null and the
base code identically.

## Goals / Non-Goals

**Goals:**

- A base-currency document cannot acquire an actual rate other than 1, by any path.
- The settlement refuses rather than silently coercing, so a wrong figure is seen by the person who
  can explain it instead of being rounded away.
- The web stops offering the field where the server would refuse it.

**Non-Goals:**

- Correcting the existing `RECBL-HAL-2026-0021` entry. That is a reversal through `gl-journal`, done by
  accounting, and no code change can do it (the ledger is append-only).
- Clearing `payment_attachment.actual_rate` when a document's currency changes. Refusing at the point
  of consumption makes the stale value harmless, and rewriting a stored statement of what somebody did
  at the bank is a worse answer than refusing to use it.
- Any guard on the locked rate at submit, which `multi-currency` already owns.

## Decisions

**One predicate, one message, used by all four call sites.** A helper on the payment-handoff side —
`assertRateFitsCurrency(documentCurrency, baseCurrency, rate)` — throws a `BadRequestException` naming
the document's currency. Four copies of an inequality is how one of them ends up missing when a fifth
path is added; this is the same reasoning `gl-journal` applies with its single balanced constructor.

**Refuse, do not coerce.** Coercing 695 to 1 at settlement would make the payment correct and leave
nobody told that the slip is wrong, so the next payment on the same slip repeats it. The refusal names
the document and the figure, and the fix is to correct the slip.

**Enforced at `record()`, not only at the input DTOs.** `record()` is where the rate becomes money —
it is the choke point every path reaches, including the batch importer, which supplies rates per line
without going near the slip services.

**Comparison is on the currency code, not the rate.** Testing `lockedRate === 1` would also catch a
foreign currency that happens to sit at parity, and would block its legitimate restatement. The
question is what the document is denominated in, which is what the code answers.

## Risks / Trade-offs

- **A batch import containing a bad rate now fails that line instead of posting it.** That is the
  point, and the batch already reports per-line failures.
- **A document whose currency is corrected to the base currency after a slip stated a rate will now
  refuse to settle** until someone fixes the slip. That is a document that would otherwise settle at a
  rate nobody intends — being stuck and visible is the better of the two.
- **No migration, so existing wrong rows stay as they are.** `RECBL-HAL-2026-0021` keeps its slip rate
  of 695; its entry is corrected by reversal. A query to find others is in `tasks.md`, and on the
  2026-10-08 production snapshot it returns that one document and nothing else.

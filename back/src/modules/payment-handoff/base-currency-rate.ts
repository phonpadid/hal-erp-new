import { BadRequestException } from '@nestjs/common';
import { Money } from '../../common/money/money';

/**
 * A document denominated in the company's own money has no exchange rate but 1.
 *
 * Stated once here because four call sites consume the same rule — a slip being attached, a rate
 * being restated without one, a payment being recorded, and the settlement that turns the rate into
 * `base_actual` — and an inequality copied four times is the one that is missing when a fifth path
 * is added.
 *
 * The comparison is on the CURRENCY CODE, not on the locked rate: a foreign currency that happens to
 * sit at parity is still a foreign currency, and its restatement is legitimate. A null
 * `document.currency` means the base currency, which is how `document-submit` already reads it.
 *
 * Refuses rather than coercing to 1. Coercion makes the payment right and leaves the slip wrong,
 * with nobody told, so the next payment reading that slip repeats it. This is not hypothetical: a
 * LAK document whose slip said 695 restated 21,000,000 as 14,595,000,000 and booked the difference
 * as FX loss, balanced, in September 2026.
 */
export function assertRateFitsCurrency(
  docCurrencyCode: string | undefined,
  baseCurrencyCode: string,
  rate: string | undefined,
): void {
  if (rate === undefined) return;
  // A company with no base currency configured cannot answer "is this the company's own money?",
  // and a rule that cannot be evaluated must not refuse: the misconfiguration is multi-currency's
  // to report, and failing here would block every payment of every such company instead.
  if (!baseCurrencyCode) return;
  const docCode = docCurrencyCode ?? baseCurrencyCode;
  if (docCode !== baseCurrencyCode) return;
  if (Money.compare(rate, '1') === 0) return;
  throw new BadRequestException(
    `This document is in ${docCode}, the company's own currency, so its exchange rate can only be 1 — ` +
      `'${rate}' would restate what was paid. Correct the rate on the transfer slip.`,
  );
}

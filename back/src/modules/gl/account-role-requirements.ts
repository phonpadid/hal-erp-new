import { STOCK_POST_ACTIONS } from '@erp/shared';
import { AccountRoleType, TaxKind } from '../../common/enums';
import { Document, DocumentType } from '../document/document.entities';
import { Company } from '../multi-company/multi-company.entities';
import { TaxCode } from '../tax/tax.entities';
import type { EntityManager } from '@mikro-orm/postgresql';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * What each system account role is for, in words somebody choosing an account can act on.
 *
 * `GRNI` names nothing to the person who has to pick an account for it, and a screen that offers
 * fourteen codes and no meanings is a screen that gets a guess rather than a decision.
 */
export const ACCOUNT_ROLE_PURPOSE: Record<AccountRoleType, string> = {
  [AccountRoleType.CASH_CLEARING]:
    'Where money sits between a payment being recorded and the bank confirming it.',
  [AccountRoleType.FX_GAIN]: 'Where a favourable difference between the locked and paid rate lands.',
  [AccountRoleType.FX_LOSS]: 'Where an unfavourable difference between the locked and paid rate lands.',
  [AccountRoleType.VAT_INPUT]: 'Purchase VAT, from the moment it is incurred until a return claims it.',
  [AccountRoleType.VAT_RECEIVABLE]: 'What the revenue authority owes once a VAT return is filed.',
  [AccountRoleType.WHT_PAYABLE]: 'Tax withheld from a payee and owed to the revenue authority.',
  [AccountRoleType.INVENTORY]: 'The value of stock on hand — debited on receipt, credited on issue.',
  [AccountRoleType.GRNI]: 'Goods received and not yet invoiced: the liability between receipt and the bill.',
  [AccountRoleType.INVENTORY_ADJUSTMENT]: 'Where a stock count difference is absorbed.',
  [AccountRoleType.INVENTORY_IN_TRANSIT]: 'Stock that has left one warehouse and not reached another.',
  [AccountRoleType.CLAIM_PAYABLE]: 'What the company owes a person for an approved claim, until paid.',
  [AccountRoleType.ACCOUNTS_PAYABLE]: 'What the company owes suppliers for approved purchases, until paid.',
  [AccountRoleType.ACCRUED_EXPENSE]: 'An expense recognised before the bill for it arrives.',
  [AccountRoleType.RETAINED_EARNINGS]: 'Where a closed year’s result is carried into the next.',
};

/** Every role the system can resolve, in the order a person would work down them. */
export const ALL_ACCOUNT_ROLES: readonly AccountRoleType[] = Object.values(AccountRoleType);

/**
 * The roles THIS company's configuration will actually ask the GL to resolve.
 *
 * Fourteen roles exist and a company typically needs four. Reporting all sixteen as missing produces
 * a checklist people skim — and a skimmed checklist is exactly how a live company came to have no
 * mappings at all, every payment posting parked, and nobody looking.
 *
 * So requirement is DERIVED from what the company has configured, never from a hand-kept list of
 * "important" roles: a list maintained beside the rules it describes stops describing them the first
 * time either moves. The rules read the same configuration the posting paths read.
 *
 * One implementation, called by both the mapping surface and the go-live inspection. Two derivations
 * of "does this company need an inventory account" would disagree the first time either was edited,
 * and the disagreement would show up as a setup checklist that contradicts the screen beside it.
 */
export async function requiredAccountRoles(
  em: EntityManager,
  company: Company,
): Promise<Set<AccountRoleType>> {
  const required = new Set<AccountRoleType>();
  const types = await em.find(
    DocumentType,
    { company: company.id, isActive: true },
    FILTER_OFF,
  );

  // Anything that settles money needs somewhere for the money to sit between being recorded and
  // clearing the bank. `CUT_BUDGET` is the settle-on-completion shape; an accruing type pays off a
  // payable it raised. Either way a payment posts, and a payment always credits the clearing account.
  const settlesPayments = types.some(
    (t) => t.postAction === 'CUT_BUDGET' || t.accruesOnApproval,
  );
  if (settlesPayments) required.add(AccountRoleType.CASH_CLEARING);

  // A type that recognises its expense at approval raises a payable, and which payable depends on
  // who is owed: a supplier or a person. Both are asked for, because the type does not say in
  // advance which of its documents will name a vendor.
  if (types.some((t) => t.accruesOnApproval)) {
    required.add(AccountRoleType.ACCOUNTS_PAYABLE);
    required.add(AccountRoleType.CLAIM_PAYABLE);
    required.add(AccountRoleType.GRNI);
  }

  // Stock movement debits and credits the inventory asset, and a count difference has to land
  // somewhere.
  if (types.some((t) => t.postAction && (STOCK_POST_ACTIONS as readonly string[]).includes(t.postAction))) {
    required.add(AccountRoleType.INVENTORY);
    required.add(AccountRoleType.INVENTORY_ADJUSTMENT);
    required.add(AccountRoleType.GRNI);
  }

  // Tax roles follow the tax codes that exist, not the documents that happen to have used one: a
  // code somebody configured is a code somebody will select.
  const taxCodes = await em.find(TaxCode, { company: company.id, isActive: true }, FILTER_OFF);
  if (taxCodes.some((t) => t.kind === TaxKind.VAT)) required.add(AccountRoleType.VAT_INPUT);
  if (taxCodes.some((t) => t.kind === TaxKind.WHT)) required.add(AccountRoleType.WHT_PAYABLE);

  // A FOREIGN-currency document can be paid at a rate other than the one it locked, and the
  // difference has to land somewhere. Asked for on the evidence of a document that exists rather
  // than of a currency that is merely active — an unused currency is not a commitment to pay in it.
  // A document in the company's own base currency is not evidence of anything: its rate is 1 and
  // its FX delta can only ever be zero.
  const baseCode = company.baseCurrency?.code;
  const withCurrency = await em.find(
    Document,
    { company: company.id, currency: { $ne: null } },
    { ...FILTER_OFF, fields: ['currency'] },
  );
  const foreign = withCurrency.some((d) => d.currency && d.currency.code !== baseCode);
  if (foreign) {
    required.add(AccountRoleType.FX_GAIN);
    required.add(AccountRoleType.FX_LOSS);
  }

  return required;
}

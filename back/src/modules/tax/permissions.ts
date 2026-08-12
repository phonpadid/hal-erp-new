/** Permission CODES for the purchase-tax capability. */
export const TaxPermissions = {
  TAX_VIEW: 'TAX_VIEW',
  TAX_MANAGE: 'TAX_MANAGE',
  /**
   * Issue a withholding certificate to a payee. Separate from TAX_MANAGE, which edits the tax-code
   * master: one is configuration, the other hands a third party a document they will file with.
   */
  WHT_CERTIFY: 'WHT_CERTIFY',
  /**
   * Remit withheld tax to the revenue authority. Separate from WHT_CERTIFY because it moves money
   * and writes the ledger, where certifying only records evidence of a deduction already made.
   */
  WHT_REMIT: 'WHT_REMIT',
} as const;

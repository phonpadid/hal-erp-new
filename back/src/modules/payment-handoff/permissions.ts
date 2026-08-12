/** Permission CODES for the payment-handoff capability. */
export const PaymentPermissions = {
  PAYMENT_VIEW: 'PAYMENT_VIEW', // read the ready-to-pay queue (for accounting)
  PAYMENT_MANAGE: 'PAYMENT_MANAGE', // record an actual payment + FX gain/loss
  PAYMENT_BATCH_VIEW: 'PAYMENT_BATCH_VIEW', // read payment runs
  PAYMENT_BATCH_MANAGE: 'PAYMENT_BATCH_MANAGE', // build, export, import a result, cancel
  // Removing evidence of a transfer is a stronger act than recording one, so it does NOT ride
  // along with PAYMENT_MANAGE: a company can let finance attach slips while reserving deletion
  // for a head. Uploading and listing slips stay on PAYMENT_MANAGE / PAYMENT_VIEW.
  PAYMENT_SLIP_DELETE: 'PAYMENT_SLIP_DELETE', // delete a payment slip
  /** Read the company's own bank accounts and the reconciliation against them. */
  BANK_ACCOUNT_VIEW: 'BANK_ACCOUNT_VIEW',
  /**
   * Create and deactivate them. Separate from reading because a bank account names the GL account a
   * balance lives in, and getting that wrong misstates cash.
   */
  BANK_ACCOUNT_MANAGE: 'BANK_ACCOUNT_MANAGE',
} as const;

/** Permission CODES for the payment-handoff capability. */
export const PaymentPermissions = {
  PAYMENT_VIEW: 'PAYMENT_VIEW', // read the ready-to-pay queue (for accounting)
  PAYMENT_MANAGE: 'PAYMENT_MANAGE', // record an actual payment + FX gain/loss
  PAYMENT_BATCH_VIEW: 'PAYMENT_BATCH_VIEW', // read payment runs
  PAYMENT_BATCH_MANAGE: 'PAYMENT_BATCH_MANAGE', // build, export, import a result, cancel
} as const;

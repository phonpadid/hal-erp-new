/** Permission CODES for the payment-handoff capability. */
export const PaymentPermissions = {
  PAYMENT_VIEW: 'PAYMENT_VIEW', // read the ready-to-pay queue (for accounting)
  PAYMENT_MANAGE: 'PAYMENT_MANAGE', // record an actual payment + FX gain/loss
} as const;

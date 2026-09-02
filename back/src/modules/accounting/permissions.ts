/** Permission CODES for the chart-of-accounts (accounting) capability. */
export const AccountingPermissions = {
  COA_VIEW: 'COA_VIEW',
  COA_MANAGE: 'COA_MANAGE',
  PERIOD_VIEW: 'PERIOD_VIEW',
  PERIOD_MANAGE: 'PERIOD_MANAGE',
  /**
   * Closing and reopening are SEPARATE codes on purpose. Closing a month is routine bookkeeping;
   * reopening one that has already been reported is not, and the two should not travel together.
   * `attendance-period` separates its own pair for the same reason.
   */
  PERIOD_CLOSE: 'PERIOD_CLOSE',
  PERIOD_REOPEN: 'PERIOD_REOPEN',
} as const;

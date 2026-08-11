export default {
  journal: {
    title: 'General Ledger',
    empty: 'No journal entries yet.',
    columns: {
      date: 'Date',
      source: 'Source',
      memo: 'Memo',
      total: 'Total',
      account: 'Account',
      debit: 'Debit',
      credit: 'Credit',
    },
  },
  voucher: {
    title: 'Journal Voucher',
    subtitle: 'The entry no event produces: depreciation, an accrual, opening balances, a correction.',
    post: 'Post voucher',
    posted: 'Voucher posted.',
    addLine: 'Add line',
    notBalanced: 'Debit and credit totals must be equal before this can be posted.',
    allZero: 'Every line is zero — a balanced voucher still has to say something.',
    oneSidedOnly: 'Each line must carry either a debit or a credit, not both.',
    fields: {
      entryDate: 'Entry date',
      memo: 'Memo',
      account: 'Account',
      accountCode: 'Account code',
      pickAccount: 'Pick an account',
    },
  },
  reversal: {
    title: 'Reverse entry',
    action: 'Reverse',
    done: 'Entry reversed.',
    datedToday:
      'A reversal is dated today unless you give a date — the original entry’s period is often closed, which is frequently why it is being reversed.',
    onceOnly: 'An entry can be reversed at most once.',
    fields: {
      entryDate: 'Reversal date (leave empty for today)',
      memo: 'Memo',
    },
  },
  periods: {
    title: 'Accounting Periods',
    subtitle: 'Closing a period stops entries being dated into it.',
    empty: 'No accounting periods declared yet.',
    declare: 'Declare period',
    close: 'Close period',
    reopen: 'Reopen period',
    declared: 'Period declared.',
    closed: 'Period closed.',
    reopened: 'Period reopened.',
    closeExplain: 'Close {code}? Once closed, no entry can be dated into it until it is reopened.',
    closesTheYear:
      'This is the last period of its fiscal year. Closing it also closes the year: revenue and expense roll into retained earnings. Reopening the period afterwards will not undo that.',
    fiscalYearsUnavailable:
      'Declaring a period needs a fiscal year, and listing fiscal years requires the FISCAL_YEAR_MANAGE permission, which you do not hold.',
    columns: {
      code: 'Code',
      start: 'Start',
      end: 'End',
      status: 'Status',
    },
    status: {
      OPEN: 'Open',
      CLOSED: 'Closed',
    },
    fields: {
      fiscalYear: 'Fiscal year',
      code: 'Code',
      start: 'Start',
      end: 'End',
      reason: 'Reason',
    },
  },
} as const;

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
} as const;

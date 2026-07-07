export default {
  list: {
    title: 'Quota',
    subtitle: 'Quota pools for this company',
    columns: {
      type: 'Type',
      unit: 'Unit',
      department: 'Department',
      limit: 'Limit',
      poolRemaining: 'Pool remaining',
      reset: 'Reset',
    },
    empty: 'No quotas for this company.',
  },
  detail: {
    companyWide: 'Company-wide',
    meta: '{department} · reset {reset} · unit {unit}',
    pool: {
      title: 'Pool',
      limit: 'Pool limit',
      used: '− Used',
      remaining: 'Pool remaining',
    },
    entitlements: {
      title: 'Entitlements',
      columns: {
        employee: 'Employee',
        year: 'Year',
        entitled: 'Entitled',
        used: 'Used',
        remaining: 'Remaining',
      },
    },
    usage: {
      title: 'Usage ledger',
      columns: {
        type: 'Type',
        qty: 'Qty',
        employee: 'Employee',
        document: 'Document',
        at: 'At',
      },
      empty: 'No usage entries yet.',
    },
  },
} as const;

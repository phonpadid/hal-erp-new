export default {
  title: 'Ready to pay',
  columns: {
    docNo: 'Document No',
    vendor: 'Vendor',
    amount: 'Amount',
    gl: 'GL account',
    action: 'Action',
  },
  empty: 'Nothing ready to pay.',
  record: {
    action: 'Record payment',
    actualRate: 'Actual exchange rate',
    confirm: 'Record',
    done: 'Payment recorded',
    baseActual: 'Base amount paid',
    fx: 'FX',
    wht: 'Withholding tax',
    noWht: 'No withholding',
    whtAmount: 'WHT withheld',
    netPaid: 'Net paid to vendor',
    kind: {
      GAIN: 'Gain',
      LOSS: 'Loss',
      NONE: 'No FX',
    },
  },
} as const;

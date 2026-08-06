export default {
  title: 'Settlements',
  subtitle: 'Record how an approved document that accrues at approval was finally paid.',
  distinctFromPayment:
    'This is not Ready-to-Pay. Recording a settlement here clears an accrue-on-approval document; recording a payment (Payments) sends a disbursement to the bank.',
  empty: 'Nothing awaiting settlement.',
  columns: {
    docNo: 'Document',
    department: 'Department',
    amount: 'Amount',
    approvedAt: 'Approved',
    action: 'Action',
  },
  types: {
    CASH: 'Cash',
  },
  record: {
    action: 'Record settlement',
    title: 'Record settlement',
    noPermission: 'You do not have permission to record settlements.',
    type: 'Settlement type',
    date: 'Settlement date',
    reference: 'Reference',
    referencePlaceholder: 'e.g. transfer / receipt no.',
    note: 'Note',
    evidence: 'Evidence',
    attach: 'Attach evidence',
    confirm: 'Record settlement',
    done: 'Settlement recorded.',
    failed: 'Could not record the settlement.',
    errors: {
      date: 'Choose a settlement date.',
      evidence: 'Attach at least one evidence file.',
    },
  },
  panel: {
    title: 'Settlement',
    type: 'Type',
    settledAt: 'Settled',
    reference: 'Reference',
    awaiting: 'Approved, awaiting settlement.',
  },
};

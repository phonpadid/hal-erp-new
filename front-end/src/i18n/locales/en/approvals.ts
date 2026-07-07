export default {
  title: 'Pending my approval',
  columns: {
    docNo: 'Document No',
    type: 'Type',
    requester: 'Requester',
    baseTotal: 'Base total',
    step: 'Step',
    submitted: 'Submitted',
    sla: 'SLA',
  },
  empty: 'Nothing awaiting your approval.',
  overdue: 'Overdue',
  dueBy: 'Due by',
} as const;

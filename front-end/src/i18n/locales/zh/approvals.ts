export default {
  title: '待我审批',
  columns: {
    docNo: '单据编号',
    type: '类型',
    requester: '申请人',
    baseTotal: '基础货币总额',
    step: '步骤',
    submitted: '提交时间',
    sla: 'SLA',
  },
  empty: '没有等待您审批的单据。',
  overdue: '已逾期',
  dueBy: '截止',
} as const;

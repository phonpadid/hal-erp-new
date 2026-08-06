export default {
  title: '结算',
  subtitle: '记录一份在审批时确认费用的已批准单据最终如何结清。',
  distinctFromPayment:
    '这不是“待付款”。在此记录结算用于清算在审批时确认费用的单据；而记录付款（Payments 页面）是把付款项发送到银行。',
  empty: '没有待结算的单据。',
  columns: {
    docNo: '单据',
    department: '部门',
    amount: '金额',
    approvedAt: '审批时间',
    action: '操作',
  },
  types: {
    CASH: '现金',
  },
  record: {
    action: '记录结算',
    title: '记录结算',
    noPermission: '您没有记录结算的权限。',
    type: '结算类型',
    date: '结算日期',
    reference: '参考号',
    referencePlaceholder: '例如：转账 / 收据编号',
    note: '备注',
    evidence: '凭证',
    attach: '上传凭证',
    confirm: '记录结算',
    done: '结算已记录。',
    failed: '无法记录结算。',
    errors: {
      date: '请选择结算日期。',
      evidence: '请至少上传一个凭证文件。',
    },
  },
  panel: {
    title: '结算',
    type: '类型',
    settledAt: '结算于',
    reference: '参考号',
    awaiting: '已批准，等待结算。',
  },
};

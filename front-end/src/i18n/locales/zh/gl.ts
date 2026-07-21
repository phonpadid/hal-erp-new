export default {
  journal: {
    title: '总账',
    empty: '暂无日记账分录。',
    columns: {
      date: '日期',
      source: '来源',
      memo: '备注',
      total: '合计',
      account: '科目',
      debit: '借方',
      credit: '贷方',
    },
  },
} as const;

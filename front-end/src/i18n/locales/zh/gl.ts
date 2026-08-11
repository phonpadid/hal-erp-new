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
  periods: {
    title: '会计期间',
    subtitle: '期间一经关闭，便无法再将分录记入该期间。',
    empty: '尚未声明任何会计期间。',
    declare: '声明期间',
    close: '关闭期间',
    reopen: '重开期间',
    declared: '期间已声明。',
    closed: '期间已关闭。',
    reopened: '期间已重开。',
    closeExplain: '关闭 {code}？关闭后，在重开之前无法再将分录记入该期间。',
    closesTheYear:
      '这是该会计年度的最后一个期间。关闭它将同时结账该年度：收入与费用结转至留存收益。此后重开该期间不会撤销结转。',
    fiscalYearsUnavailable:
      '声明期间需要选择会计年度，而查看会计年度列表需要 FISCAL_YEAR_MANAGE 权限，您当前没有该权限。',
    columns: {
      code: '代码',
      start: '开始',
      end: '结束',
      status: '状态',
    },
    status: {
      OPEN: '开启',
      CLOSED: '已关闭',
    },
    fields: {
      fiscalYear: '会计年度',
      code: '代码',
      start: '开始',
      end: '结束',
      reason: '原因',
    },
  },
} as const;

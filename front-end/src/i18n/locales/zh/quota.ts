export default {
  list: {
    title: '配额',
    subtitle: '本公司的配额池',
    columns: {
      type: '类型',
      unit: '单位',
      department: '部门',
      limit: '上限',
      poolRemaining: '池剩余',
      reset: '重置',
    },
    empty: '本公司暂无配额。',
  },
  detail: {
    companyWide: '全公司',
    meta: '{department} · 重置 {reset} · 单位 {unit}',
    pool: {
      title: '配额池',
      limit: '池上限',
      used: '− 已用',
      remaining: '池剩余',
    },
    entitlements: {
      title: '额度授予',
      columns: {
        employee: '员工',
        year: '年份',
        entitled: '已授予',
        used: '已用',
        remaining: '剩余',
      },
    },
    usage: {
      title: '使用分类账',
      columns: {
        type: '类型',
        qty: '数量',
        employee: '员工',
        document: '单据',
        at: '时间',
      },
      empty: '暂无使用记录。',
    },
  },
} as const;

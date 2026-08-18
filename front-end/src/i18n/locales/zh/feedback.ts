// Action feedback (toasts) + destructive-action confirmation prompts. Generic copy;
// area-specific success detail can be passed in by the caller.
export default {
  success: '成功',
  warning: '警告',
  error: '错误',
  errorFallback: '请求失败',
  confirmHeader: '请确认',
  created: '创建成功',
  updated: '保存成功',
  deleted: '删除成功',
  submitted: '提交成功',
  done: '完成',
  confirm: {
    documentCancel: '取消此单据？已预留的预算和配额将被释放。',
    documentCancelRouting: '该单据正在审批人手中。撤回后将从其待办中移除，并释放已预留的预算与配额。',
    documentReject: '拒绝此单据？已预留的预算和配额将被释放。',
    closeFiscalYear: '关闭此财年？此操作无法撤销。',
    removeHoliday: '移除此节假日？',
    revokeAccess: '撤销此用户对当前公司的访问权限？',
    removeAssignment: '移除此角色分配？',
    detachPermission: '从该角色分离此权限？',
    cancelDelegation: '取消此委派？',
  },
} as const;

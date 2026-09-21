export default {
  config: {
    notFound: {
      type: '未找到该单据类型。',
      category: '未找到该单据分类。',
      template: '未找到该表单模板。',
      field: '未找到该表单字段。',
      department: '未找到该部门。',
      mapping: '未找到该部门映射。',
      pairing: '未找到该引用配对。',
      workflow: '未找到该审批流程。',
      step: '未找到该审批步骤。',
      delegation: '未找到该委托。',
    },
    type: {
      codeExists: "本公司已存在代码为 '{typeCode}' 的单据类型。",
      categoryInactive: "'{categoryCode}' 不是本公司已启用的单据分类。",
      voucherTypeExists: "本公司已有一个启用中的记账凭证类型（'{existingCode}'）。请先停用它再配置另一个。",
      payeeNeedsVendor: "单据类型 '{typeCode}' 要求收款方但不要求供应商。收款方是供应商的银行账户——请同时开启“需要供应商”。",
      stockNeedsWarehouse: "单据类型 '{typeCode}' 会移动库存但不要求仓库——请开启“需要仓库”。",
      accrualNeedsBudgetOrVendor: "单据类型 '{typeCode}' 在审批时确认费用，但既不需要预算也不需要供应商——请开启“需要预算”或“需要供应商”。",
      accrualMustSettle: "单据类型 '{typeCode}' 在审批时确认费用并预留预算，因此必须自行核销——请将 post-action 设为 CUT_BUDGET。",
      cannotSettle: "单据类型 '{typeCode}' 预留预算但没有核销途径。请将 post-action 设为 CUT_BUDGET，或添加从它到可核销类型的引用配对——若它并不花费预算，请关闭“需要预算”。",
      wouldStrand: "此更改会让单据类型 '{typeCode}' 预留预算却无法核销。更改前请保留从它到可核销类型的配对，或为它设置可核销的 post-action。",
    },
    category: {
      codeExists: "本公司已存在代码为 '{categoryCode}' 的分类。",
      inUse: '该分类正被一个或多个单据类型使用。请停用而不是删除。',
    },
    form: {
      notDraft: '该表单模板处于 {status} 状态。请创建新版本以修改字段。',
      notPublished: '该表单模板处于 {status} 状态而非 PUBLISHED，无法停用。',
      unknownFieldType: "'{fieldType}' 不是已知的字段类型。",
      dropdownNeedsOptions: '下拉字段需要选项。',
      optionsNotJson: '下拉选项不是有效的 JSON。',
      optionsEmpty: '下拉选项必须是非空列表。',
    },
    mapping: {
      templateOfOtherType: '该表单模板属于另一个单据类型。',
      templateRetired: '已停用的表单模板不能映射。',
      differentCompanies: '部门与单据类型属于不同公司。',
      duplicate: '该部门已映射到该单据类型。请编辑现有映射。',
      typeNotEnabled: '该单据类型尚未对此部门启用。',
    },
    pairing: {
      selfChain: '单据类型不能与自身形成链条。',
      duplicate: '该引用配对已存在。',
    },
    step: {
      amountOrder: '最小金额不得超过最大金额。',
      duplicateNo: '此流程中已存在第 {stepNo} 步。',
      roleNotInCompany: '所选角色（{field}）不是当前公司的角色。',
      userNotInCompany: '所选人员（{field}）不是当前公司的成员。',
      noApprover: '第 {stepNo} 步未指定审批人。请选择审批角色或人员，否则无人能处理。',
    },
    workflow: {
      inUseByMapping: '该流程正被部门映射使用。请删除映射或停用流程。',
      inUseByDocuments: '该流程已被单据引用。请停用而不是删除。',
    },
  },
  // Finance's intake book. The receive path answers per document rather than throwing, so only
  // the reversal refusals are named here.
  intake: {
    notFound: '本公司内没有该单据。',
    notReceived: '单据 {docNo} 目前未登记为已签收，没有可撤销的内容。',
  },
};

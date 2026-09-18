/**
 * Refusals the server names by `messageKey`. The seam (`utils/apiError.ts#messageOf`) renders
 * `errors.<key>` with the server's `params` when a key is known here, and falls back to the
 * server's English `message` otherwise. Written for the person configuring the system: name the
 * thing by its code, say what to do, never show an id.
 */
export default {
  config: {
    notFound: {
      type: 'The document type was not found.',
      category: 'The document category was not found.',
      template: 'The form template was not found.',
      field: 'The form field was not found.',
      department: 'The department was not found.',
      mapping: 'The department mapping was not found.',
      pairing: 'The reference pairing was not found.',
      workflow: 'The workflow was not found.',
      step: 'The workflow step was not found.',
      delegation: 'The delegation was not found.',
    },
    type: {
      codeExists: "A document type with code '{typeCode}' already exists in this company.",
      categoryInactive: "'{categoryCode}' is not an active document category in this company.",
      voucherTypeExists:
        "This company already has an active journal-voucher type ('{existingCode}'). Deactivate it before configuring another.",
      payeeNeedsVendor:
        "Document type '{typeCode}' requires a payee but not a vendor. A payee is a vendor's bank account — turn on 'requires vendor' as well.",
      stockNeedsWarehouse:
        "Document type '{typeCode}' moves stock but does not require a warehouse — turn on 'requires warehouse'.",
      accrualNeedsBudgetOrVendor:
        "Document type '{typeCode}' recognises its expense at approval but requires neither budget nor a vendor — turn on 'requires budget' or 'requires vendor'.",
      accrualMustSettle:
        "Document type '{typeCode}' recognises its expense at approval and reserves budget, so it must settle that reservation itself — set its post-action to CUT_BUDGET.",
      cannotSettle:
        "Document type '{typeCode}' reserves budget but has no way to settle it. Set its post-action to CUT_BUDGET, or add a reference pairing from it to an active type that does — or turn off 'requires budget' if it does not spend.",
      wouldStrand:
        "This change would leave document type '{typeCode}' reserving budget with no way to settle it. Keep a pairing from it to a type that settles, or give it a settling post-action, before making this change.",
    },
    category: {
      codeExists: "A category with code '{categoryCode}' already exists in this company.",
      inUse: 'This category is used by one or more document types. Deactivate it instead of deleting.',
    },
    form: {
      notDraft: 'This form template is {status}. Create a new version to change its fields.',
      notPublished: 'This form template is {status}, not PUBLISHED, so it cannot be retired.',
      unknownFieldType: "'{fieldType}' is not a known field type.",
      dropdownNeedsOptions: 'A dropdown field needs its options.',
      optionsNotJson: 'The dropdown options are not valid JSON.',
      optionsEmpty: 'The dropdown options must be a non-empty list.',
    },
    mapping: {
      templateOfOtherType: 'That form template belongs to a different document type.',
      templateRetired: 'A retired form template cannot be mapped.',
      differentCompanies: 'The department and the document type belong to different companies.',
      duplicate: 'This department is already mapped to that document type. Edit the existing mapping instead.',
      typeNotEnabled: 'This document type is not enabled for the department.',
    },
    pairing: {
      selfChain: 'A document type cannot chain to itself.',
      duplicate: 'This reference pairing already exists.',
    },
    step: {
      amountOrder: 'The minimum amount must not exceed the maximum amount.',
      duplicateNo: 'Step {stepNo} already exists in this workflow.',
      roleNotInCompany: 'The selected role ({field}) is not a role of the active company.',
      userNotInCompany: 'The selected person ({field}) is not a member of the active company.',
      noApprover: 'Step {stepNo} names no approver. Choose an approver role or a person, or nothing will ever be able to act on it.',
    },
    workflow: {
      inUseByMapping: 'This workflow is used by a department mapping. Remove the mapping or deactivate the workflow instead.',
      inUseByDocuments: 'This workflow is referenced by documents. Deactivate it instead of deleting.',
    },
  },
};

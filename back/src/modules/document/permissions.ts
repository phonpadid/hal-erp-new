/** Permission CODES for the document-engine capability. */
export const DocumentPermissions = {
  DOC_CONFIG_MANAGE: 'DOC_CONFIG_MANAGE', // document_type / form / dept mapping
  DOC_VIEW: 'DOC_VIEW',
  DOC_CREATE: 'DOC_CREATE',
  DOC_SUBMIT: 'DOC_SUBMIT',
  DOC_CANCEL: 'DOC_CANCEL',
  DOC_RECEIVE: 'DOC_RECEIVE', // record goods receipt against a PO's lines
  // State a day earlier than today on a document that records something that already happened.
  // Separate from DOC_CREATE/DOC_SUBMIT on purpose: raising a document is ordinary work, while
  // deciding which quarter its money falls in moves a figure between two periods of the year and is
  // the thing an auditor asks about.
  DOC_BACKDATE: 'DOC_BACKDATE',
  // Move the account one line of a document in approval posts to, on a step configured to allow
  // it. Not DOC_APPROVE: every approver holds that, and a department head has no business choosing
  // between 606.03 and 636.04. Not GL_JV_POST either: writing a voucher is a larger privilege than
  // moving one line's account, and a company may grant one without the other. Its own code lets
  // the step editor ask a precise question — "can this step's approver actually use this?"
  DOC_LINE_RECODE: 'DOC_LINE_RECODE',
  // Register that a document reached this user's desk — finance's intake book. Deliberately NOT
  // DOC_RECEIVE: that one is goods receipt against a PO's lines, and a code that means two
  // different receipts is a code that gets granted for one and used for the other.
  //
  // Holding it is necessary and not sufficient: the document must also have reached the holder
  // (an opened route step naming them), which is what stops a finance officer registering paper
  // that never came to them.
  DOC_INTAKE_RECEIVE: 'DOC_INTAKE_RECEIVE',
  // Undo a receipt. Its own code because reversal is the privileged correction, not part of
  // ordinary intake: everyone in finance receives, one person fixes a mistake. The receipt itself
  // survives — the reversal is a new row on an append-only log.
  DOC_INTAKE_REVERSE: 'DOC_INTAKE_REVERSE',
} as const;

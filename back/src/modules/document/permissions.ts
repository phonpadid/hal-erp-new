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
} as const;

/** Permission CODES for the document-engine capability. */
export const DocumentPermissions = {
  DOC_CONFIG_MANAGE: 'DOC_CONFIG_MANAGE', // document_type / form / dept mapping
  DOC_VIEW: 'DOC_VIEW',
  DOC_CREATE: 'DOC_CREATE',
  DOC_SUBMIT: 'DOC_SUBMIT',
  DOC_CANCEL: 'DOC_CANCEL',
  DOC_RECEIVE: 'DOC_RECEIVE', // record goods receipt against a PO's lines
} as const;

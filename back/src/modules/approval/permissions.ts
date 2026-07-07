/** Permission CODES for the approval-workflow capability. */
export const ApprovalPermissions = {
  WORKFLOW_MANAGE: 'WORKFLOW_MANAGE', // workflow / step / delegation config
  DOC_APPROVE: 'DOC_APPROVE', // act on approvals
  DOC_VIEW: 'DOC_VIEW', // read the audit trail
} as const;

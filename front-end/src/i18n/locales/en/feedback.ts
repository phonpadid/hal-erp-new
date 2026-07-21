// Action feedback (toasts) + destructive-action confirmation prompts. Generic copy;
// area-specific success detail can be passed in by the caller.
export default {
  success: 'Success',
  warning: 'Warning',
  error: 'Error',
  errorFallback: 'Request failed',
  confirmHeader: 'Please confirm',
  created: 'Created successfully',
  updated: 'Saved successfully',
  deleted: 'Deleted successfully',
  submitted: 'Submitted successfully',
  done: 'Done',
  confirm: {
    documentCancel: 'Cancel this document? Reserved budget and quota will be released.',
    documentReject: 'Reject this document? Reserved budget and quota will be released.',
    closeFiscalYear: 'Close this fiscal year? This cannot be undone.',
    removeHoliday: 'Remove this holiday?',
    revokeAccess: "Revoke this user's access to the active company?",
    removeAssignment: 'Remove this role assignment?',
    detachPermission: 'Detach this permission from the role?',
    cancelDelegation: 'Cancel this delegation?',
  },
} as const;

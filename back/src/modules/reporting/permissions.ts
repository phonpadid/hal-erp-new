/** Permission CODES for the reporting capability (read-only operational reports). */
export const ReportingPermissions = {
  REPORT_VIEW: 'REPORT_VIEW',
  // Cross-company consolidated reports — meaningful ONLY at GROUP scope.
  REPORT_GROUP_VIEW: 'REPORT_GROUP_VIEW',
} as const;

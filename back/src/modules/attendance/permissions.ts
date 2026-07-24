/** Permission CODES for the attendance capability. */
export const AttendancePermissions = {
  // Shift / location master (attendance-shift slice).
  ATTEND_SHIFT_READ: 'ATTEND_SHIFT_READ',
  ATTEND_SHIFT_MANAGE: 'ATTEND_SHIFT_MANAGE',
  // Punch capture (attendance-capture slice). SELF punches only as yourself; MANAGE punches for
  // others including backdated; READ sees other people's punches.
  ATTEND_PUNCH_SELF: 'ATTEND_PUNCH_SELF',
  ATTEND_PUNCH_MANAGE: 'ATTEND_PUNCH_MANAGE',
  ATTEND_PUNCH_READ: 'ATTEND_PUNCH_READ',
  // Daily projection (attendance-daily slice). READ sees computed days; RECOMPUTE rebuilds them.
  ATTEND_DAY_READ: 'ATTEND_DAY_READ',
  ATTEND_DAY_RECOMPUTE: 'ATTEND_DAY_RECOMPUTE',
} as const;

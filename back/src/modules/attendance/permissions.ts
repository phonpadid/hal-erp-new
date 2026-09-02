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
  // Daily projection (attendance-daily slice). SELF sees only your OWN days; READ sees everyone's;
  // RECOMPUTE rebuilds them. SELF exists separately because the two reads are two different powers:
  // gating `days/me` on READ would mean that letting somebody see their own attendance let them see
  // the whole company's. The capture slice drew exactly this line over the punch ledger from the
  // start; the daily slice had no self-service caller to reveal that it had not.
  ATTEND_DAY_SELF: 'ATTEND_DAY_SELF',
  ATTEND_DAY_READ: 'ATTEND_DAY_READ',
  ATTEND_DAY_RECOMPUTE: 'ATTEND_DAY_RECOMPUTE',
  // Leave-type configuration (notice windows, backdating, certificate threshold).
  LEAVE_MANAGE: 'LEAVE_MANAGE',
  // Certifying overtime for someone else, and configuring the statutory weekly ceiling.
  OT_CLAIM_MANAGE: 'OT_CLAIM_MANAGE',
  // Correcting the punch ledger on someone else's behalf, and setting how far back a correction
  // may reach. Raising a correction about your OWN day needs no code beyond document creation —
  // it changes nothing until it is approved.
  ATTEND_CORRECTION_MANAGE: 'ATTEND_CORRECTION_MANAGE',
  // Attendance periods. Four codes because these are four different powers: reading a period,
  // declaring one, closing it, and reaching back into one that may already have been paid against.
  // A role that closes every month should not thereby be able to reopen last quarter.
  ATTEND_PERIOD_READ: 'ATTEND_PERIOD_READ',
  ATTEND_PERIOD_MANAGE: 'ATTEND_PERIOD_MANAGE',
  ATTEND_PERIOD_CLOSE: 'ATTEND_PERIOD_CLOSE',
  ATTEND_PERIOD_REOPEN: 'ATTEND_PERIOD_REOPEN',
} as const;

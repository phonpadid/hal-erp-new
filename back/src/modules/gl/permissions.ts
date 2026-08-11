/** Permission CODES for the general-ledger (gl-journal) capability. */
export const GlPermissions = {
  GL_VIEW: 'GL_VIEW',
  /**
   * Re-queue a posting the sweep gave up on. A separate code from GL_VIEW because re-queuing
   * writes, and separate from the chart-of-accounts codes because the people who watch for
   * undelivered postings are not necessarily the people who edit accounts.
   */
  GL_POST_RETRY: 'GL_POST_RETRY',
  /**
   * Write a journal entry by hand, and reverse one. The largest privilege in the system: it is the
   * only way a person writes the ledger directly, and it is guarded by this code rather than by an
   * approval route. Grant it to very few people until that route exists.
   *
   * One code for both posting and reversing — a reversal is a voucher whose lines were computed for
   * you, and splitting them would imply a difference in privilege that is not there.
   */
  GL_JV_POST: 'GL_JV_POST',
} as const;

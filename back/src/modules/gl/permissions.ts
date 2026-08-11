/** Permission CODES for the general-ledger (gl-journal) capability. */
export const GlPermissions = {
  GL_VIEW: 'GL_VIEW',
  /**
   * Re-queue a posting the sweep gave up on. A separate code from GL_VIEW because re-queuing
   * writes, and separate from the chart-of-accounts codes because the people who watch for
   * undelivered postings are not necessarily the people who edit accounts.
   */
  GL_POST_RETRY: 'GL_POST_RETRY',
} as const;

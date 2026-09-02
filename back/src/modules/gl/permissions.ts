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
   * SUBMIT a journal voucher — by hand, or as a reversal — for approval. It no longer writes the
   * ledger on its own: `GL_JV_APPROVE` does that, and never for the person who submitted.
   *
   * One code for both submitting and reversing, still: a reversal is a voucher whose lines were
   * computed for you, and splitting them would imply a difference in privilege that is not there.
   * Which is also why a reversal takes the same approval — leaving it immediate would make this one
   * code mean both "submit for approval" and "write the ledger unreviewed", the second being the
   * stronger, and an unreviewed path beside a control is what makes the control decorative.
   */
  GL_JV_POST: 'GL_JV_POST',
  /**
   * Approve a submitted voucher, which posts it. Distinct from `GL_JV_POST` because the whole point
   * is that two people are involved; the service refuses self-approval even when one user holds
   * both, since a rule depending on nobody granting two codes is a convention rather than a control
   * (invariant 8).
   */
  GL_JV_APPROVE: 'GL_JV_APPROVE',
} as const;

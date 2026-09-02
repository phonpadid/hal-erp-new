/**
 * The document types this suite claims to cover, written down rather than discovered, so the
 * report names one test per type and a type added to (or dropped from) the company shows up as a
 * failing guard rather than as coverage that silently shrank.
 *
 * `00-sandbox` asserts this list still matches the company's active `document_type` rows.
 */

/** requires_budget + post_action CUT_BUDGET — reserve at submit, settle at approval. */
export const DISBURSEMENT_TYPES = [
  'REC',
  'RECADMIN',
  'RECAM',
  'RECBK',
  'RECHP',
  'RECHPY',
  'RECILD',
  'RECMK',
  'RECMKP',
  'RECSS',
  'RECWH',
] as const;

/** post_action ACTIVATE_BUDGET — authored through /budgets/plans, not the generic wizard. */
export const PLAN_TYPES = ['BUDGET_PLAN'] as const;

/** No post action and no budget requirement — the plain approval route. */
export const PLAIN_TYPES = ['SPEND_HIST'] as const;

export const ALL_EXPECTED_TYPES = [
  ...DISBURSEMENT_TYPES,
  ...PLAN_TYPES,
  ...PLAIN_TYPES,
];

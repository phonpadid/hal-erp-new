/**
 * Allowed predecessor → successor document-type pairings for the reference chain
 * (PR→PO, ADVANCE→CLEAR_ADVANCE, …). Keyed by the SUCCESSOR's `document_type.code`,
 * valued by the set of predecessor `document_type.code`s it may be created from.
 *
 * This is configuration, not per-type branching logic: adding a chain is a data edit
 * here, not a code change in the document services. It lives in a config file (rather
 * than a new DBML column) per the change's design decision to add no new columns; the
 * services read it through `isRefPairingAllowed` so the storage can later move to the
 * database without touching call sites.
 */
export const REF_CHAIN: Record<string, readonly string[]> = {
  PO: ['PR', 'PROC'],
  DISB: ['PO'],
  CLEAR_ADVANCE: ['ADVANCE'],
};

/** Whether a successor of `successorCode` may reference a predecessor of `predecessorCode`. */
export function isRefPairingAllowed(predecessorCode: string, successorCode: string): boolean {
  return (REF_CHAIN[successorCode] ?? []).includes(predecessorCode);
}

/**
 * Successor type codes that may be created from a predecessor of `predecessorCode`
 * (reverse of REF_CHAIN). Used by the CREATE_PO post-action to auto-create the PO from an
 * approved PR — it only auto-creates when exactly one successor resolves.
 */
export function successorTypesFor(predecessorCode: string): string[] {
  return Object.entries(REF_CHAIN)
    .filter(([, predecessors]) => predecessors.includes(predecessorCode))
    .map(([successor]) => successor);
}

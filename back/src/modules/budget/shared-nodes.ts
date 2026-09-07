/** A node as the inheritance walk needs it: who its parent is, and whether it was marked. */
export interface SharedNodeInput {
  id: string;
  parentId?: string;
  isShared: boolean;
}

/**
 * Which nodes carry shared budget once inheritance is applied — marked, or beneath something
 * marked.
 *
 * A mark on `1.100` has to reach `1.101`, `1.102` and every line added under it later; otherwise
 * the customer would tick the office supplies, the cleaning materials and the drinking water one at
 * a time and re-tick each new one. The subtree IS the unit, which is why the mark sits on the node.
 *
 * The same "own node or an ancestor of it" walk `budget-control` already performs to decide which
 * control points govern a budget. One shape, computed here once, so the two cannot drift.
 *
 * Walks UP from each node rather than down from each marked one: the caller already holds the set
 * it cares about, and walking down would need the whole tree even to answer about one node. Results
 * are memoised across the set, so a deep plan costs one pass, not one pass per leaf.
 *
 * A parent that is not in `nodes` ends the walk unmarked. That is the honest answer for a partial
 * set — a caller holding one department's nodes cannot see a mark placed above them — and callers
 * that need certainty pass the whole fiscal year. A cycle, which `requireParent` refuses on write,
 * ends the walk rather than hanging.
 */
export function sharedNodeIds(nodes: SharedNodeInput[]): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const answer = new Map<string, boolean>();

  const isShared = (start: SharedNodeInput): boolean => {
    // The chain walked to reach an answer: every node on it shares that answer, so one walk
    // resolves all of them.
    const chain: string[] = [];
    const seen = new Set<string>();
    let node: SharedNodeInput | undefined = start;
    let result = false;

    while (node) {
      const known = answer.get(node.id);
      if (known !== undefined) {
        result = known;
        break;
      }
      if (seen.has(node.id)) break; // cycle in bad data; refuse to spin
      seen.add(node.id);
      chain.push(node.id);
      if (node.isShared) {
        result = true;
        break;
      }
      node = node.parentId ? byId.get(node.parentId) : undefined;
    }

    for (const id of chain) answer.set(id, result);
    return result;
  };

  const out = new Set<string>();
  for (const n of nodes) if (isShared(n)) out.add(n.id);
  return out;
}

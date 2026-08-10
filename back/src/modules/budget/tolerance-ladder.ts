import { BadRequestException } from '@nestjs/common';
import { Money } from '../../common/money/money';

export type ToleranceAction = 'WARN' | 'BLOCK';

export interface ToleranceRung {
  /** Percent of the ceiling at which this rung starts applying, e.g. 100 for "at the ceiling". */
  at: number;
  action: ToleranceAction;
}

export type ToleranceOutcome = 'OK' | 'WARN' | 'BLOCK';

const ACTIONS: ToleranceAction[] = ['WARN', 'BLOCK'];

/**
 * The tolerance ladder that replaces the binary HARD_STOP / SOFT_WARNING policy.
 *
 * A ladder is an ordered list of `{at, action}` rungs evaluated against
 * `(used + requested) / ceiling`. EVERY rung whose threshold is met or exceeded applies, and a
 * matched BLOCK beats any matched WARN — so the order rungs are written in cannot change the
 * outcome, and a ladder listing BLOCK before WARN is not a configuration error.
 *
 * The binary policy is expressible exactly, which is what makes the migration behaviour-preserving:
 *   HARD_STOP    → [{ at: 100, action: 'BLOCK' }]
 *   SOFT_WARNING → [{ at: 100, action: 'WARN'  }]
 *
 * A ladder is validated when it is WRITTEN and never interpreted permissively when it is READ. An
 * unparseable ladder at check time is a hard failure, not an "allow": a budget control that fails
 * open is worse than no budget control, because it reports as if it were working.
 */
export const ToleranceLadder = {
  /** HARD_STOP's exact equivalent. */
  BLOCK_AT_CEILING: [{ at: 100, action: 'BLOCK' as const }] satisfies ToleranceRung[],
  /** SOFT_WARNING's exact equivalent. */
  WARN_AT_CEILING: [{ at: 100, action: 'WARN' as const }] satisfies ToleranceRung[],

  /**
   * Validate and normalise a ladder given as parsed JSON. Throws BadRequestException on anything
   * that is not a usable ladder — an empty list included, since a control point with no rungs
   * would check nothing while appearing configured.
   */
  parse(raw: unknown, context = 'tolerance ladder'): ToleranceRung[] {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new BadRequestException(
        `${context} must be a non-empty array of {at, action} rungs; an empty ladder would check nothing`,
      );
    }
    const rungs: ToleranceRung[] = raw.map((entry, i) => {
      if (typeof entry !== 'object' || entry === null) {
        throw new BadRequestException(`${context}[${i}] must be an object with 'at' and 'action'`);
      }
      const { at, action } = entry as { at?: unknown; action?: unknown };
      if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) {
        throw new BadRequestException(
          `${context}[${i}].at must be a finite percentage of 0 or more, got ${String(at)}`,
        );
      }
      if (typeof action !== 'string' || !ACTIONS.includes(action as ToleranceAction)) {
        throw new BadRequestException(
          `${context}[${i}].action must be one of ${ACTIONS.join(' | ')}, got ${String(action)}`,
        );
      }
      return { at, action: action as ToleranceAction };
    });
    return rungs;
  },

  /** Validate and normalise a ladder stored as JSON text. */
  parseJson(json: string, context = 'tolerance ladder'): ToleranceRung[] {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      throw new BadRequestException(`${context} is not valid JSON`);
    }
    return ToleranceLadder.parse(raw, context);
  },

  stringify(rungs: ToleranceRung[]): string {
    return JSON.stringify(rungs);
  },

  /**
   * Decide the outcome for a requested amount against a ceiling.
   *
   * `used` may exceed `ceiling` already (an approved ADJUST_DECREASE can push a control point
   * negative without any check), and a ceiling of zero is possible for a control point whose
   * budgets all sit at zero. Both are handled without dividing by zero: with a zero ceiling, any
   * positive request is over it, and a zero request is not.
   */
  evaluate(
    rungs: ToleranceRung[],
    input: { ceiling: string; used: string; requested: string },
  ): ToleranceOutcome {
    const after = Money.add(input.used, input.requested);
    // Cross-multiplied rather than divided: `after / ceiling > at / 100` becomes
    // `after * 100 > ceiling * at`. Both sides are exact decimal multiplications, so no division
    // by a possibly-zero ceiling and no JS float ever touches an amount.
    const lhs = Money.multiply(after, '100');
    let outcome: ToleranceOutcome = 'OK';
    for (const rung of rungs) {
      const rhs = Money.multiply(input.ceiling, String(rung.at));
      if (Money.compare(lhs, rhs) <= 0) continue;
      // `at` is the point the rung STARTS applying, so equality is inside the allowance:
      // at 100 with used+requested exactly equal to the ceiling is not yet over budget.
      if (rung.action === 'BLOCK') return 'BLOCK';
      outcome = 'WARN';
    }
    return outcome;
  },
};

import { parseStepMinRank } from '@erp/shared';
import type { UserOption, WorkflowStepRow } from '../api/docConfig';

/**
 * Shared read helpers for approval-workflow steps, used by both the Workflows list
 * (compact chip summary) and the workflow detail view (full step table). Kept here so
 * the two surfaces stay consistent instead of duplicating the parsing/label logic.
 */

/** Job levels a step (or workflow) is restricted to, parsed from its `condition_json`. */
export function parseJobLevels(conditionJson?: string): string[] {
  if (!conditionJson) return [];
  try {
    const parsed = JSON.parse(conditionJson) as { jobLevels?: string[] };
    return Array.isArray(parsed.jobLevels) ? parsed.jobLevels : [];
  } catch {
    return [];
  }
}

/** The step's minRank threshold (rank ≥ N engages it), or null when it uses a list / no condition. */
export function stepMinRank(conditionJson?: string): number | null {
  // Explicit list wins over minRank (see @erp/shared stepConditionMode), so only report a threshold
  // when there is no explicit level list.
  if (parseJobLevels(conditionJson).length > 0) return null;
  return parseStepMinRank(conditionJson);
}


/** Human amount band for a step, e.g. `0–∞`, or '' when the step has no bounds. */
export function amountBand(amountMin?: string, amountMax?: string): string {
  if (!amountMin && !amountMax) return '';
  return `${amountMin ?? '0'}–${amountMax ?? '∞'}`;
}

/** One-line chip summary for a step: number, mode, SLA, amount band, level restriction. */
export function stepChipLabel(s: WorkflowStepRow): string {
  const parts = [`#${s.stepNo} ${s.approveMode}`];
  if (s.slaHours) parts.push(`${s.slaHours}h`);
  const band = amountBand(s.amountMin, s.amountMax);
  if (band) parts.push(band);
  const levels = parseJobLevels(s.conditionJson);
  if (levels.length) parts.push(levels.join('/'));
  const minRank = stepMinRank(s.conditionJson);
  if (minRank != null) parts.push(`≥rank ${minRank}`);
  return parts.join(' · ');
}

/**
 * Display label for a step's approver: the specific person's username if set, else the
 * role's code, falling back to the raw id so a step is never shown blank when the option
 * lists have not resolved. Returns '' when no approver is configured.
 */
export function approverLabel(
  s: Pick<WorkflowStepRow, 'approverUserId' | 'approverRoleId'>,
  roles: Array<{ id: string; code: string }>,
  users: UserOption[],
): string {
  if (s.approverUserId) {
    return users.find((u) => u.id === s.approverUserId)?.username ?? s.approverUserId;
  }
  if (s.approverRoleId) {
    return roles.find((r) => r.id === s.approverRoleId)?.code ?? s.approverRoleId;
  }
  return '';
}

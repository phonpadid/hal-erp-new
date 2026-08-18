// The DTO decorators need the metadata polyfill; Nest loads it at bootstrap, vitest does not.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ApproveAction } from '../../common/enums';
import { ActDto } from './dto/workflow.dto';

/**
 * The approval endpoint's DTO under the app's own validation settings (`main.ts` configures
 * `ValidationPipe` with `whitelist` + `forbidNonWhitelisted`).
 *
 * This is the layer that has to refuse `ESCALATE`, not the routing engine: `act()` persists its
 * append-only `approval_log` row BEFORE it switches on the action, so an accepted-but-unhandled
 * value became a history row reading "Escalated (SLA)" on a document whose SLA never elapsed —
 * written by the approver who did not want to approve it. A refusal that happens after the insert
 * is not a refusal.
 */
const PIPE = { whitelist: true, forbidNonWhitelisted: true } as const;

async function check(payload: Record<string, unknown>) {
  return validate(plainToInstance(ActDto, payload), PIPE);
}

describe('ActDto validation', () => {
  it.each([ApproveAction.APPROVE, ApproveAction.REJECT, ApproveAction.RETURN])(
    'accepts %s, the actions a person performs',
    async (action) => {
      expect(await check({ action })).toHaveLength(0);
    },
  );

  it('refuses ESCALATE — it belongs to the SLA sweep, not to a caller', async () => {
    const errors = await check({ action: ApproveAction.ESCALATE });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('action');
  });

  it('refuses DELEGATE, which no longer exists as an action', async () => {
    expect(await check({ action: 'DELEGATE' })).toHaveLength(1);
  });

  // A withdrawal is the requester ending their own request, authorised by DOC_CANCEL on the
  // document's cancel endpoint. It is recorded in the same table, but it is not a decision about
  // somebody else's document and does not arrive here.
  it('refuses CANCEL — a withdrawal is not an approval decision', async () => {
    expect(await check({ action: ApproveAction.CANCEL })).toHaveLength(1);
  });

  it('refuses an unknown action rather than ignoring it', async () => {
    expect(await check({ action: 'APPROVE_MAYBE' })).toHaveLength(1);
  });

  it('keeps the remark optional', async () => {
    expect(await check({ action: ApproveAction.REJECT, remark: 'over budget' })).toHaveLength(0);
  });
});

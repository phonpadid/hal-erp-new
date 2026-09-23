import type { EntityManager } from '@mikro-orm/postgresql';
import { AppUser, UserSignature } from '../modules/rbac/rbac.entities';

/**
 * Give a user a current signature, the way `SignatureService.upload` would minus the bytes: an
 * immutable `user_signature` row plus `app_user.current_signature_id` pointing at it. Returns the
 * signature id so a test can assert what got stamped.
 *
 * Submitting and approving both refuse a person with no signature (SIGNATURE_REQUIRED), so any
 * fixture user who submits or approves needs this. Accepts an EntityManager and forks it, so it is
 * safe to call from a test that holds its own fork.
 */
export async function giveSignature(
  em: EntityManager,
  userId: string,
  filePath = `signatures/${userId}/sig.png`,
): Promise<string> {
  const fork = em.fork();
  const sig = fork.create(UserSignature, {
    user: fork.getReference(AppUser, userId),
    filePath,
    mimeType: 'image/png',
    uploadedAt: new Date(),
  });
  fork.persist(sig);
  await fork.flush(); // assign the id before pointing current at it
  const user = await fork.findOneOrFail(AppUser, { id: userId });
  user.currentSignatureId = sig.id;
  await fork.flush();
  return sig.id;
}

/** Sign several users at once — the usual shape for a fixture with a requester and approvers. */
export async function giveSignatures(em: EntityManager, userIds: string[]): Promise<void> {
  for (const id of userIds) await giveSignature(em, id);
}

/**
 * Give every user in the test database a signature. For a spec whose subject is something other
 * than signatures — budgets, routes, slips — this is the one line that keeps its fixture people
 * able to submit and approve, without naming each of them.
 */
export async function signAllUsers(em: EntityManager): Promise<void> {
  const fork = em.fork();
  const unsigned = await fork.find(AppUser, { currentSignatureId: null });
  for (const u of unsigned) await giveSignature(em, u.id);
}

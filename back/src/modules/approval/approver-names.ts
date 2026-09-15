import type { EntityManager } from '@mikro-orm/postgresql';
import { AppUser, Employee } from '../rbac/rbac.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Display names for a set of users: the person's employee full name in this company, falling back
 * to the login username when they have no employee record here.
 *
 * A username is an account, not a person. `xone` and `finance_head` are what someone types to sign
 * in; an approval trail is read by people asking who signed, and it should answer with their name.
 * The document detail already resolves its requester this way (`document.service.ts`), and this is
 * the same resolution — extracted so the approval history, the "waiting on" step and the requester
 * line cannot drift into calling the same person three different things.
 *
 * Scoped to one company because `employee` is, and a user may hold a record in several: the name
 * to show is the one belonging to the company whose document is being read.
 *
 * Read as partials (one name field) rather than by populating the relation: returning an AppUser
 * entity from an endpoint serializes the whole account row.
 */
export async function displayNames(
  em: EntityManager,
  companyId: string,
  userIds: Iterable<string>,
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  const names = new Map<string, string>();
  if (!ids.length) return names;

  const employees = await em.find(
    Employee,
    { user: { $in: ids }, company: companyId },
    { fields: ['fullName', 'user'], ...FILTER_OFF },
  );
  for (const e of employees) {
    // An employee row with a blank name is worse than the username it would replace.
    if (e.user?.id && e.fullName?.trim()) names.set(e.user.id, e.fullName);
  }

  const unnamed = ids.filter((id) => !names.has(id));
  if (unnamed.length) {
    const users = await em.find(AppUser, { id: { $in: unnamed } }, { fields: ['username'], ...FILTER_OFF });
    for (const u of users) names.set(u.id, u.username);
  }
  return names;
}

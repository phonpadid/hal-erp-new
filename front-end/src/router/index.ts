import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { routes } from './routes';

// The route table lives in ./routes (side-effect-free) so it can be imported in tests
// without creating the router / browser history. Re-export the breadcrumb meta type
// for consumers that import it from '@/router'.
export type { BreadcrumbCrumb } from './routes';

/** State the guard needs — kept minimal so it can be unit-tested in isolation. */
export interface GuardState {
  isAuthenticated: boolean;
  hasCompany: boolean;
  can: (code: string) => boolean;
}

export interface GuardRoute {
  name?: string | null;
  meta: { public?: boolean; requiresCompany?: boolean; permission?: string };
}

/** Where the guard sends a navigation it will not allow. */
export interface GuardTarget {
  name: string;
  query?: Record<string, string>;
}

/**
 * Pure routing guard. Returns where to send the navigation, or null to allow it.
 * Gating is by permission CODE only (invariant 5; UX-only).
 *
 * A refusal for want of a permission goes to `forbidden` carrying the code, not to `home`.
 * Sending it home made four situations identical on screen — a mistyped address, a retired page,
 * a permission this user lacks, and a permission NO user can hold because the catalog has no row
 * for it. The last is how closing an accounting period sat unreachable for an entire installation
 * with nothing anywhere admitting it.
 *
 * The code travels because it is the string an administrator acts on: searches for, grants, or
 * discovers is absent from the catalog. "You do not have permission" alone returns the reader to
 * guessing, which is the failure being repaired.
 */
export function evaluateGuard(state: GuardState, route: GuardRoute): GuardTarget | null {
  if (route.meta.public) return null;
  if (!state.isAuthenticated) return { name: 'login' };
  if (route.meta.requiresCompany !== false && !state.hasCompany && route.name !== 'select-company') {
    return { name: 'select-company' };
  }
  if (route.meta.permission && !state.can(route.meta.permission)) {
    return { name: 'forbidden', query: { code: route.meta.permission } };
  }
  return null;
}

const router = createRouter({
  // vite's `base`, not a second copy of it: the build and the router have to agree on where
  // the SPA lives, and the way they stop agreeing is someone changing one of two literals.
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  const target = evaluateGuard(
    { isAuthenticated: auth.isAuthenticated, hasCompany: auth.hasCompany, can: (c) => auth.can(c) },
    { name: to.name as string | undefined, meta: to.meta as { public?: boolean; requiresCompany?: boolean; permission?: string } },
  );
  return target && target.name !== to.name ? target : true;
});

export default router;

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

/**
 * Pure routing guard. Returns the name of the route to redirect to, or null to
 * allow navigation. Gating is by permission CODE only (invariant 5; UX-only).
 */
export function evaluateGuard(state: GuardState, route: GuardRoute): string | null {
  if (route.meta.public) return null;
  if (!state.isAuthenticated) return 'login';
  if (route.meta.requiresCompany !== false && !state.hasCompany && route.name !== 'select-company') {
    return 'select-company';
  }
  if (route.meta.permission && !state.can(route.meta.permission)) return 'home';
  return null;
}

const router = createRouter({
  history: createWebHistory('/new/'), // base path for the front-end SPA (matches nginx config)
  routes,
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  const target = evaluateGuard(
    { isAuthenticated: auth.isAuthenticated, hasCompany: auth.hasCompany, can: (c) => auth.can(c) },
    { name: to.name as string | undefined, meta: to.meta as { public?: boolean; requiresCompany?: boolean; permission?: string } },
  );
  return target && target !== to.name ? { name: target } : true;
});

export default router;

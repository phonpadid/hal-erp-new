import axios from 'axios';
import { useAuthStore } from '../stores/auth';

/**
 * Typed API client. Attaches the company-context JWT on every request.
 *
 * The default is ORIGIN-RELATIVE, and deliberately so. Vite inlines `VITE_API_URL` at BUILD
 * time, which makes a bundle correct only for the environment it was built in — and the old
 * default was an absolute `http://localhost:3000`, so a build made anywhere the variable was
 * unset shipped a production asset pointing at the visitor's own machine. Nothing catches that:
 * the bundle compiles, CI goes green, and it fails in the browser. A leading slash resolves
 * against the page's origin instead, so one artifact is correct everywhere it is served from —
 * which is what the deploy now assumes, building once in CI and shipping that build to the host.
 *
 * Not affected by vite's `base: '/new/'`: a leading slash resolves against the ORIGIN, giving
 * `<origin>/api-new/...`, not `/new/api-new/...`. It does require the origin serving this SPA to
 * route `/api-new` to the backend — nginx does, and the dev server proxies it (see vite.config.ts).
 *
 * `VITE_API_URL` still overrides, for pointing a local front-end at some other backend.
 */
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api-new',
});

api.interceptors.request.use((config) => {
  const auth = useAuthStore();
  if (auth.token) {
    config.headers.Authorization = `Bearer ${auth.token}`;
  }
  return config;
});

// A stale/expired token must not wedge the app: clear the session and return to Login.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error?.response?.status === 401) {
      const auth = useAuthStore();
      auth.logout();
      // Lazy import avoids a router ↔ api ↔ store import cycle.
      const { default: router } = await import('../router');
      if (router.currentRoute.value.name !== 'login') {
        await router.push({ name: 'login' });
      }
    }
    return Promise.reject(error);
  },
);

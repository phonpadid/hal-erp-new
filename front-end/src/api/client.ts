import axios from 'axios';
import { useAuthStore } from '../stores/auth';

/** Typed API client. Attaches the company-context JWT on every request. */
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
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

import { defineStore } from 'pinia';
import { api } from '../api/client';

const TOKEN_KEY = 'erp_token';

export interface AccessibleCompany {
  id: string;
  code: string;
  nameTh: string;
  isDefault: boolean;
}

interface Grant {
  code: string;
  scope: string;
}

export interface BaseCurrency {
  code: string;
  decimalPlaces: number;
}

interface AuthState {
  token: string | null;
  userId: string | null;
  username: string | null;
  displayName: string | null;
  roleName: string | null;
  profileImageUrl: string | null;
  activeCompanyId: string | null;
  /** Home department — where a new document is raised. */
  departmentId: string | null;
  /** Every department the user is assigned to in the active company (contains `departmentId`). */
  departmentIds: string[];
  permissions: string[];
  companies: AccessibleCompany[];
  baseCurrency: BaseCurrency | null;
}

/**
 * Active-company session. Only the token is persisted; the live context
 * (company, department, permission codes) is always re-fetched from /auth/me so
 * it can never drift from the server. UI gates on permission CODE (invariant 5);
 * the server stays authoritative.
 */
export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    token: localStorage.getItem(TOKEN_KEY),
    userId: null,
    username: null,
    displayName: null,
    roleName: null,
    profileImageUrl: null,
    activeCompanyId: null,
    departmentId: null,
    departmentIds: [],
    permissions: [],
    companies: [],
    baseCurrency: null,
  }),
  getters: {
    isAuthenticated: (s) => !!s.token,
    hasCompany: (s) => !!s.activeCompanyId,
    can: (s) => (code: string) => s.permissions.includes(code),
  },
  actions: {
    setToken(token: string) {
      this.token = token;
      localStorage.setItem(TOKEN_KEY, token);
    },

    /** Authenticate. Returns the next route name: 'home' or 'select-company'. */
    async login(username: string, password: string): Promise<'home' | 'select-company'> {
      const { data } = await api.post('/auth/login', { username, password });
      this.companies = data.companies ?? [];
      if (data.accessToken) {
        this.setToken(data.accessToken);
        await this.refresh();
        return 'home';
      }
      return 'select-company';
    },

    /** Switch to a company the user belongs to; re-issues the token + permissions. */
    async selectCompany(companyId: string): Promise<void> {
      const { data } = await api.post('/auth/switch-company', { companyId });
      this.setToken(data.accessToken);
      await this.refresh();
    },

    /** Pull live context from /auth/me (single source of truth). */
    async refresh(): Promise<void> {
      const { data } = await api.get('/auth/me');
      this.userId = data.userId;
      this.username = data.username ?? null;
      this.displayName = data.displayName ?? null;
      this.roleName = data.roleName ?? null;
      this.profileImageUrl = data.profileImageUrl ?? null;
      this.activeCompanyId = data.companyId;
      this.departmentId = data.departmentId;
      this.departmentIds = data.departmentIds ?? (data.departmentId ? [data.departmentId] : []);
      this.permissions = (data.grants ?? []).map((g: Grant) => g.code);
      this.baseCurrency = data.baseCurrency ?? null;
    },

    /** Load the companies the user may switch to (for the header switcher). */
    async loadCompanies(): Promise<void> {
      const { data } = await api.get('/companies/mine');
      this.companies = data ?? [];
    },

    /** Restore a persisted session on app start; a dead token logs out. */
    async restore(): Promise<void> {
      if (!this.token) return;
      try {
        await this.refresh();
        // Repopulate the header switcher's options: login() fills `companies`, but on a
        // page refresh only restore() runs, so without this the switcher has no options
        // and hides. Non-critical, so its own failure must not log the user out.
        await this.loadCompanies().catch(() => undefined);
      } catch {
        this.logout();
      }
    },

    logout() {
      localStorage.removeItem(TOKEN_KEY);
      this.$reset();
      this.token = null;
    },
  },
});

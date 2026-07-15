import { defineStore } from 'pinia';
import { apiKeysApi } from '../api/apiKeys';
import type { ApiKeyView, EligibleUser, IssuedApiKey } from '../api/apiKeys';
import type { IssueApiKeyInput } from '@erp/shared';
import { messageOf } from '../utils/apiError';

interface ApiKeysState {
  keys: ApiKeyView[];
  eligibleUsers: EligibleUser[];
  loading: boolean;
  error: string;
}

export const useApiKeysStore = defineStore('apiKeys', {
  state: (): ApiKeysState => ({ keys: [], eligibleUsers: [], loading: false, error: '' }),
  actions: {
    async loadKeys() {
      this.loading = true;
      this.error = '';
      try {
        this.keys = await apiKeysApi.list();
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async loadEligibleUsers() {
      try {
        this.eligibleUsers = await apiKeysApi.eligibleUsers();
      } catch (e) {
        this.error = messageOf(e);
      }
    },

    /** Issue a key; returns the one-time secret on success, or null on failure. */
    async issueKey(dto: IssueApiKeyInput): Promise<IssuedApiKey | null> {
      this.error = '';
      try {
        const issued = await apiKeysApi.issue(dto);
        await this.loadKeys();
        return issued;
      } catch (e) {
        this.error = messageOf(e);
        return null;
      }
    },

    async revokeKey(id: string): Promise<boolean> {
      this.error = '';
      try {
        await apiKeysApi.revoke(id);
        await this.loadKeys();
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },
  },
});

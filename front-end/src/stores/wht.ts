import { defineStore } from 'pinia';
import { whtApi, type WhtCertificateRow } from '../api/wht';
import { messageOf } from '../utils/apiError';

interface WhtState {
  certificates: WhtCertificateRow[];
  total: string;
  loading: boolean;
  working: boolean;
  error: string;
}

/** The tax withheld from vendors and not yet paid over to the revenue authority. */
export const useWhtStore = defineStore('wht', {
  state: (): WhtState => ({ certificates: [], total: '0', loading: false, working: false, error: '' }),
  actions: {
    async load() {
      this.loading = true;
      this.error = '';
      try {
        const res = await whtApi.outstanding();
        this.certificates = res.items;
        this.total = res.total;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    /** Returns a boolean and leaves the server's refusal in `error`, unaltered. */
    async remit(certificateIds: string[], remittedOn: string): Promise<boolean> {
      this.working = true;
      this.error = '';
      try {
        await whtApi.remit(certificateIds, remittedOn);
        await this.load();
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      } finally {
        this.working = false;
      }
    },
  },
});

import { defineStore } from 'pinia';
import { jobLevelsApi } from '../api/jobLevels';
import type { JobLevel, SelectableJobLevel } from '../api/jobLevels';
import { messageOf } from '../utils/apiError';

interface JobLevelsState {
  jobLevels: JobLevel[];
  total: number;
  page: number;
  limit: number;
  selectable: SelectableJobLevel[];
  loading: boolean;
  error: string;
}

export const useJobLevelsStore = defineStore('jobLevels', {
  state: (): JobLevelsState => ({
    jobLevels: [], total: 0, page: 1, limit: 20, selectable: [], loading: false, error: '',
  }),
  actions: {
    async loadJobLevels(page?: number, limit?: number, includeInactive = true) {
      this.loading = true;
      this.error = '';
      try {
        const res = await jobLevelsApi.list(page ?? this.page, limit ?? this.limit, includeInactive);
        this.page = res.page;
        this.limit = res.limit;
        this.total = res.total;
        this.jobLevels = res.items;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    // Active levels only — for the employee and workflow-step editors.
    async loadSelectable() {
      try {
        this.selectable = await jobLevelsApi.selectable();
      } catch (e) {
        this.error = messageOf(e);
      }
    },

    async createJobLevel(dto: unknown): Promise<boolean> {
      this.error = '';
      try {
        await jobLevelsApi.create(dto);
        await this.loadJobLevels();
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },

    async updateJobLevel(id: string, dto: unknown): Promise<boolean> {
      this.error = '';
      try {
        await jobLevelsApi.update(id, dto);
        await this.loadJobLevels();
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },
  },
});

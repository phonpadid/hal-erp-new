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
  /**
   * The search term the server is answering, per list. Kept in the store rather than passed
   * per call so paging keeps it: page 2 of a search is page 2 of that same search.
   */
  search: string;
  loading: boolean;
  error: string;
}

export const useJobLevelsStore = defineStore('jobLevels', {
  state: (): JobLevelsState => ({
    jobLevels: [], total: 0, page: 1, limit: 20, selectable: [], search: '', loading: false, error: '',
  }),
  actions: {
    async loadJobLevels(page?: number, limit?: number, includeInactive = true, search?: string) {
      this.loading = true;
      this.error = '';
      if (search !== undefined) this.search = search;
      try {
        const res = await jobLevelsApi.list(
          page ?? this.page, limit ?? this.limit, includeInactive, this.search || undefined,
        );
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

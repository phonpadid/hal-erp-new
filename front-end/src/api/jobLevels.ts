import { api } from './client';
import type { Paginated } from './pagination';

// Per-company position-level master. `code` is what employee.job_level and workflow_step
// condition_json reference; `rank` orders seniority (drives the step editor's minRank mode).
export interface JobLevel {
  id: string;
  code: string;
  name: string;
  rank: number;
  isActive: boolean;
}

// Active levels for the employee / workflow-step pickers.
export interface SelectableJobLevel {
  id: string;
  code: string;
  name: string;
  rank: number;
}

export const jobLevelsApi = {
  list: (page = 1, limit = 100, includeInactive = false) =>
    api.get<Paginated<JobLevel>>('/job-levels', { params: { page, limit, includeInactive } }).then((r) => r.data),
  selectable: () => api.get<SelectableJobLevel[]>('/job-levels/selectable').then((r) => r.data),
  create: (dto: unknown) => api.post('/job-levels', dto).then((r) => r.data),
  update: (id: string, dto: unknown) => api.patch(`/job-levels/${id}`, dto).then((r) => r.data),
  deactivate: (id: string) => api.delete(`/job-levels/${id}`).then((r) => r.data),
};

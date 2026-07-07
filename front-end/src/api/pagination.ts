/** The paged envelope every list endpoint returns (mirrors the backend Paginated<T>). */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export const DEFAULT_LIMIT = 20;

import { IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EntityName, FilterQuery, FindOptions } from '@mikro-orm/core';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** Shared `?page=&limit=` query for every list endpoint (transform: true coerces). */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

/** The paged envelope every list endpoint returns. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/** Normalize raw query → 1-based page, clamped limit (default/max), and DB offset. */
export function pageParams(q: { page?: number; limit?: number }): {
  page: number;
  limit: number;
  offset: number;
} {
  const page = q.page && q.page >= 1 ? Math.floor(q.page) : 1;
  const raw = q.limit && q.limit >= 1 ? Math.floor(q.limit) : DEFAULT_LIMIT;
  const limit = Math.min(raw, MAX_LIMIT);
  return { page, limit, offset: (page - 1) * limit };
}

/**
 * Count + slice in one go (`findAndCount`). Callers build `where` (company scope + filters)
 * and pass populate/orderBy in `options`; this only adds the page window. `total` is the
 * full count of the scoped/filtered set.
 */
export async function paginate<T extends object>(
  em: EntityManager,
  entity: EntityName<T>,
  where: FilterQuery<T>,
  options: FindOptions<T, any, any, any>,
  q: { page?: number; limit?: number },
): Promise<Paginated<T>> {
  const { page, limit, offset } = pageParams(q);
  const [items, total] = await em.findAndCount(entity, where, { ...options, offset, limit });
  return { items: items as unknown as T[], total, page, limit };
}

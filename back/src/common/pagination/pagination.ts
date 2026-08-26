import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
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

/**
 * `page`/`limit` plus a free-text `search`, for the list endpoints that APPLY one.
 *
 * Deliberately a separate DTO rather than a field on {@link PaginationQueryDto}. Putting it there
 * is one line and covers every list — and makes every list endpoint accept a term it silently
 * drops, which tells the caller their request was understood when it was not. That is the same
 * falsehood as a search box wired to nothing, one layer down. An endpoint that has not been wired
 * keeps rejecting the parameter, which `forbidNonWhitelisted` already does for free.
 */
export class SearchablePaginationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

/**
 * Narrow an already-scoped `where` by a case-insensitive match of `term` across `fields`.
 *
 * NARROWS, never replaces. The `where` handed in is the one the caller already scoped by company
 * (invariant 1) and by permission; this only ever `$and`s onto it, so a search term cannot reach a
 * row that scope excluded. That is what makes the same helper safe across every list endpoint
 * instead of each one arguing the point separately.
 *
 * A blank, absent or whitespace-only term returns the input unchanged, so "searching for nothing"
 * is the unfiltered list rather than a predicate that matches everything by accident.
 *
 * `$ilike` over a company-scoped set of at most a few thousand rows needs no index; if a screen
 * ever gets slow the answer is a trigram index chosen from a measurement, not guessed at here.
 */
export function withSearch<T extends object>(
  where: FilterQuery<T>,
  term: string | undefined,
  fields: string[],
): FilterQuery<T> {
  const trimmed = term?.trim();
  if (!trimmed || !fields.length) return where;
  const like = { $ilike: `%${trimmed}%` };
  const match = { $or: fields.map((f) => nest(f, like)) };
  return { $and: [where, match] } as FilterQuery<T>;
}

/**
 * Turn a dotted field path into the nested object MikroORM expects: `'node.code'` becomes
 * `{ node: { code: <cond> } }`.
 *
 * A flat `{ 'node.code': cond }` key is NOT equivalent. MikroORM emits it verbatim as
 * `"node"."code"`, an alias it never joined, and Postgres rejects the whole query with
 * `missing FROM-clause entry for table "node"` — so the budget list would have 500'd on every
 * search rather than returning the wrong rows. The nested form goes through the relation and gets
 * the real join alias.
 */
function nest(path: string, condition: object): Record<string, unknown> {
  const parts = path.split('.');
  return parts.reduceRight<Record<string, unknown>>(
    (acc, key) => ({ [key]: acc }),
    condition as Record<string, unknown>,
  );
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

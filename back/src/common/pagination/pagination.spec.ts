import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMIT, MAX_LIMIT, pageParams } from './pagination';

describe('pageParams', () => {
  it('defaults to page 1 and the default limit when omitted', () => {
    expect(pageParams({})).toEqual({ page: 1, limit: DEFAULT_LIMIT, offset: 0 });
  });

  it('computes the offset from page and limit', () => {
    expect(pageParams({ page: 3, limit: 20 })).toEqual({ page: 3, limit: 20, offset: 40 });
  });

  it('clamps an over-max limit to the maximum (never unbounded)', () => {
    expect(pageParams({ page: 1, limit: 100000 }).limit).toBe(MAX_LIMIT);
  });

  it('floors/normalizes invalid page and limit to safe values', () => {
    expect(pageParams({ page: 0, limit: 0 })).toEqual({ page: 1, limit: DEFAULT_LIMIT, offset: 0 });
    expect(pageParams({ page: 2.7, limit: 10.9 })).toEqual({ page: 2, limit: 10, offset: 10 });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: { items: [], total: 0, page: 1, limit: 20 } })) },
}));

import { api } from './client';
import { documentsApi } from './documents';

const get = api.get as unknown as ReturnType<typeof vi.fn>;

describe('documentsApi.list filter serialization', () => {
  beforeEach(() => get.mockClear());

  it('joins status into a comma string and omits empty/undefined filters', async () => {
    await documentsApi.list(2, 20, {
      status: ['DRAFT', 'SUBMITTED'],
      docNo: 'PR',
      minAmount: '',
      documentTypeId: undefined,
    });
    expect(get).toHaveBeenCalledWith('/documents', {
      params: { page: 2, limit: 20, status: 'DRAFT,SUBMITTED', docNo: 'PR' },
    });
  });

  it('passes amount bounds through as strings (no JS-number coercion)', async () => {
    await documentsApi.list(1, 20, { minAmount: '9007199254740993.01', maxAmount: '50' });
    const params = get.mock.calls[0][1].params;
    expect(params.minAmount).toBe('9007199254740993.01');
    expect(typeof params.minAmount).toBe('string');
    expect(typeof params.maxAmount).toBe('string');
  });

  it('sends docNo as a server query param (server-side search)', async () => {
    await documentsApi.list(1, 20, { docNo: 'A-PR' });
    expect(get.mock.calls[0][1].params.docNo).toBe('A-PR');
  });

  it('omits all filter params when none are set', async () => {
    await documentsApi.list();
    expect(get).toHaveBeenCalledWith('/documents', { params: { page: 1, limit: 20 } });
  });
});

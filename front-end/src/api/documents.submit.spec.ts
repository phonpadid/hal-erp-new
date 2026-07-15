import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
  api: {
    post: vi.fn(() => Promise.resolve({ data: {} })),
    get: vi.fn(() => Promise.resolve({ data: [] })),
  },
}));

import { api } from './client';
import { documentsApi } from './documents';
import { quotasApi } from './quotas';

const post = api.post as unknown as ReturnType<typeof vi.fn>;
const get = api.get as unknown as ReturnType<typeof vi.fn>;

describe('documentsApi.submit body', () => {
  beforeEach(() => post.mockClear());

  it('posts quota reservations for a requires_quota submit', async () => {
    await documentsApi.submit('d1', { quotaReservations: [{ quotaId: 'q1', qty: '2' }] });
    expect(post).toHaveBeenCalledWith('/documents/d1/submit', {
      quotaReservations: [{ quotaId: 'q1', qty: '2' }],
    });
    // qty stays a string (money/quantity is never a JS number over the wire).
    expect(typeof post.mock.calls[0][1].quotaReservations[0].qty).toBe('string');
  });

  it('posts an empty body when there are no reservations', async () => {
    await documentsApi.submit('d1');
    expect(post).toHaveBeenCalledWith('/documents/d1/submit', {});
  });
});

describe('quotasApi.selectable', () => {
  beforeEach(() => get.mockClear());

  it('reads the requester-facing selectable quota endpoint', async () => {
    await quotasApi.selectable();
    expect(get).toHaveBeenCalledWith('/quotas/selectable');
  });
});

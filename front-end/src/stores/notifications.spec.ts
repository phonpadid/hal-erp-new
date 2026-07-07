import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNotificationsStore } from './notifications';
import { notificationsApi } from '../api/notifications';

vi.mock('../api/notifications', async (orig) => ({
  ...(await orig<typeof import('../api/notifications')>()),
  notificationsApi: { list: vi.fn(), markRead: vi.fn() },
}));

const m = notificationsApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe('useNotificationsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('load populates items and derives unread count', async () => {
    m.list.mockResolvedValueOnce({
      items: [
        { id: 'n1', isRead: false },
        { id: 'n2', isRead: true },
        { id: 'n3', isRead: false },
      ],
      total: 3,
      page: 1,
      limit: 20,
    });
    const s = useNotificationsStore();
    await s.load();
    expect(s.items).toHaveLength(3);
    expect(s.unreadCount).toBe(2);
  });

  it('markRead flips the item and lowers the count', async () => {
    m.list.mockResolvedValueOnce({ items: [{ id: 'n1', isRead: false }], total: 1, page: 1, limit: 20 });
    m.markRead.mockResolvedValueOnce(undefined);
    const s = useNotificationsStore();
    await s.load();
    expect(s.unreadCount).toBe(1);
    await s.markRead('n1');
    expect(s.unreadCount).toBe(0);
    expect(s.items[0].isRead).toBe(true);
  });

  it('captures an error', async () => {
    m.list.mockRejectedValueOnce({ response: { data: { message: 'boom' } } });
    const s = useNotificationsStore();
    await s.load();
    expect(s.error).toBe('boom');
  });
});

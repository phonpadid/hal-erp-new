import { defineStore } from 'pinia';
import { notificationsApi } from '../api/notifications';
import type { NotificationItem } from '../api/notifications';
import { messageOf } from '../utils/apiError';

interface NotificationsState {
  items: NotificationItem[];
  total: number;
  page: number;
  limit: number;
  loading: boolean;
  error: string;
}


export const useNotificationsStore = defineStore('notifications', {
  state: (): NotificationsState => ({ items: [], total: 0, page: 1, limit: 20, loading: false, error: '' }),
  getters: {
    unreadCount: (s): number => s.items.filter((n) => !n.isRead).length,
  },
  actions: {
    async load(page?: number, limit?: number) {
      this.loading = true;
      this.error = '';
      try {
        const res = await notificationsApi.list(page ?? this.page, limit ?? this.limit); // server orders newest first
        this.items = res.items;
        this.total = res.total;
        this.page = res.page;
        this.limit = res.limit;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async markRead(id: string) {
      try {
        await notificationsApi.markRead(id);
        const item = this.items.find((n) => n.id === id);
        if (item) item.isRead = true;
      } catch (e) {
        this.error = messageOf(e);
      }
    },

    async markAllRead() {
      const unread = this.items.filter((n) => !n.isRead).map((n) => n.id);
      for (const id of unread) await this.markRead(id);
    },
  },
});

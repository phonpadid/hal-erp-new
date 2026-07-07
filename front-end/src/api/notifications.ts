import { api } from './client';
import type { Paginated } from './pagination';

export interface NotificationItem {
  id: string;
  subject?: string | null;
  body?: string | null;
  channel?: string;
  isRead: boolean;
  createdAt?: string | null;
  document?: { id?: string } | string | null;
}

/** The document id a notification points at, tolerant of how the relation serializes. */
export function documentIdOf(n: NotificationItem): string | null {
  const d = n.document;
  if (!d) return null;
  return typeof d === 'string' ? d : d.id ?? null;
}

/** Own-inbox reads (the server enforces access by signed-in user). */
export const notificationsApi = {
  list: (page = 1, limit = 20, unreadOnly = false) =>
    api
      .get<Paginated<NotificationItem>>('/notifications', { params: { page, limit, unreadOnly } })
      .then((r) => r.data),
  markRead: (id: string) => api.post(`/notifications/${id}/read`, {}).then((r) => r.data),
};

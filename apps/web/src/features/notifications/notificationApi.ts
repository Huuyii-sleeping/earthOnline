import { apiClient } from "@/lib/api/client";
import type { NotificationResponse, PaginatedResponse } from "@earth-online/shared";

// --- Notifications API ---

/** GET /notifications?page=&page_size= — 当前用户通知分页 */
export async function listNotifications(
  page = 1,
  pageSize = 20,
): Promise<PaginatedResponse<NotificationResponse>> {
  const res = await apiClient.get<PaginatedResponse<NotificationResponse>>("/notifications", {
    params: { page, page_size: pageSize },
  });
  return res.data;
}

/** GET /notifications/unread-count — 未读数量（用于红点） */
export async function getUnreadCount(): Promise<number> {
  const res = await apiClient.get<{ data: { unread: number } }>("/notifications/unread-count");
  return res.data.data.unread;
}

/** POST /notifications/:id/read — 标记单条已读 */
export async function markRead(notificationId: string): Promise<void> {
  await apiClient.post(`/notifications/${notificationId}/read`);
}

/** POST /notifications/read-all — 全部标记已读 */
export async function markAllRead(): Promise<void> {
  await apiClient.post(`/notifications/read-all`);
}

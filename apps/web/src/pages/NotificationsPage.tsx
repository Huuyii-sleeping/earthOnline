import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationResponse } from "@earth-online/shared";
import { Button } from "@/components/ui/button";
import { listNotifications, markAllRead, markRead } from "@/features/notifications/notificationApi";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function NotificationsPage() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["notifications"],
    queryFn: () => listNotifications(),
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
  });

  const markAllMutation = useMutation({
    mutationFn: markAllRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
  });

  const notifications = query.data?.data ?? [];
  const hasUnread = notifications.some((n) => !n.is_read);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Bell className="h-5 w-5" />
          通知
        </h1>
        {hasUnread && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => markAllMutation.mutate()}
            disabled={markAllMutation.isPending}
          >
            <CheckCheck className="mr-1.5 h-4 w-4" />
            全部已读
          </Button>
        )}
      </div>

      {query.isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : query.error ? (
        <EmptyState text="通知加载失败，请稍后重试" />
      ) : notifications.length === 0 ? (
        <EmptyState text="暂无通知" />
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => (
            <NotificationRow
              key={n.id}
              notification={n}
              onMarkRead={() => markReadMutation.mutate(n.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NotificationRow({
  notification,
  onMarkRead,
}: {
  notification: NotificationResponse;
  onMarkRead: () => void;
}) {
  return (
    <li
      className={`flex items-start gap-3 rounded-lg border p-4 text-left text-sm shadow-sm transition-colors ${
        notification.is_read ? "bg-card" : "bg-amber-50/60"
      }`}
    >
      <div
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
          notification.is_read ? "bg-transparent" : "bg-primary"
        }`}
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{notification.title}</p>
        {notification.body && <p className="mt-1 text-muted-foreground">{notification.body}</p>}
        <p className="mt-1 text-xs text-muted-foreground">{formatDate(notification.created_at)}</p>
      </div>
      {!notification.is_read && (
        <button
          type="button"
          onClick={onMarkRead}
          className="shrink-0 text-xs text-primary hover:underline"
        >
          标记已读
        </button>
      )}
    </li>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border bg-card py-16 text-muted-foreground">
      <Bell className="h-10 w-10" />
      <p className="mt-3 text-sm">{text}</p>
    </div>
  );
}

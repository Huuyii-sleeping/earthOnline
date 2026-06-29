import { Bell } from "lucide-react";

export default function NotificationsPage() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="rounded-lg border bg-card p-8 text-center shadow-sm">
        <Bell className="mx-auto h-12 w-12 text-muted-foreground" />
        <h1 className="mt-4 text-xl font-semibold">通知</h1>
        <p className="mt-2 text-sm text-muted-foreground">暂无通知</p>
        <div className="mt-6 space-y-2">
          {["有人点赞了你的奖章", "你获得了一枚新奖章", "有人关注了你"].map((text, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-md bg-muted/50 px-4 py-3 text-left text-sm text-muted-foreground"
            >
              <div className="h-2 w-2 rounded-full bg-primary" />
              {text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

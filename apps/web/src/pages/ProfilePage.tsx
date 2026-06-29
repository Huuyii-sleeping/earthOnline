import { Link } from "react-router-dom";
import { Award, Clock, Eye, EyeOff, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/useAuth";
import { useMedalStore } from "@/features/medals/medalStore";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function ProfilePage() {
  const { nickname } = useAuth();
  const medals = useMedalStore((state) => state.medals);

  return (
    <div className="space-y-8">
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-xl font-bold text-primary-foreground">
              {nickname?.[0]?.toUpperCase() ?? "U"}
            </div>
            <div>
              <h1 className="text-xl font-semibold">个人主页</h1>
              <p className="text-sm text-muted-foreground">
                {medals.length > 0
                  ? `已经保存 ${medals.length} 枚经历奖章`
                  : "这里展示你的个人成就档案"}
              </p>
            </div>
          </div>
          <Button asChild>
            <Link to="/create">
              <PlusCircle className="mr-2 h-4 w-4" />
              创建经历
            </Link>
          </Button>
        </div>
      </div>

      <section>
        <div className="mb-4 flex items-center gap-2">
          <Award className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">奖章墙</h2>
        </div>

        {medals.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {medals.map((medal) => (
              <Link
                key={medal.id}
                to={`/medals/${medal.id}`}
                className="rounded-lg border bg-card p-5 shadow-sm transition-colors hover:bg-muted/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-800">
                    <Award className="h-7 w-7" />
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {medal.visibility === "public" ? (
                      <>
                        <Eye className="h-3 w-3" />
                        公开
                      </>
                    ) : (
                      <>
                        <EyeOff className="h-3 w-3" />
                        私密
                      </>
                    )}
                  </span>
                </div>
                <h3 className="mt-4 font-semibold">{medal.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{medal.summary}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {medal.tags.map((tag) => (
                    <span key={tag} className="rounded-full border px-2 py-0.5 text-xs">
                      {tag}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex aspect-square flex-col items-center justify-center rounded-lg border bg-card p-4 text-muted-foreground"
              >
                <Award className="h-8 w-8" />
                <p className="mt-2 text-xs">待解锁</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-4 flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">经历时间线</h2>
        </div>

        {medals.length > 0 ? (
          <div className="space-y-3">
            {medals.map((medal) => (
              <Link
                key={`timeline-${medal.id}`}
                to={`/medals/${medal.id}`}
                className="flex gap-4 rounded-lg border bg-card p-4 shadow-sm transition-colors hover:bg-muted/50"
              >
                <div className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-muted">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">{medal.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatDate(medal.createdAt)}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{medal.summary}</p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-lg border bg-card py-12 text-muted-foreground">
            <Clock className="h-10 w-10" />
            <p className="mt-3 text-sm">暂无经历记录</p>
            <p className="mt-1 text-xs">创建你的第一段经历吧</p>
          </div>
        )}
      </section>
    </div>
  );
}

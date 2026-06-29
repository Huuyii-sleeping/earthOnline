import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Award, Eye, EyeOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMedalStore } from "@/features/medals/medalStore";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function MedalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const medal = useMedalStore((state) => (id ? state.getMedal(id) : undefined));
  const removeMedal = useMedalStore((state) => state.removeMedal);
  const updateVisibility = useMedalStore((state) => state.updateVisibility);

  if (!medal) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="rounded-lg border bg-card p-8 shadow-sm">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-muted">
            <Award className="h-10 w-10 text-muted-foreground" />
          </div>
          <h1 className="mt-4 text-xl font-semibold">没有找到这枚奖章</h1>
          <p className="mt-2 text-sm text-muted-foreground">它可能已经被删除，或者只存在于其他浏览器。</p>
          <Button asChild className="mt-6">
            <Link to="/profile">返回个人主页</Link>
          </Button>
        </div>
      </div>
    );
  }

  const handleDelete = () => {
    removeMedal(medal.id);
    navigate("/profile", { replace: true });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button asChild variant="ghost" className="px-0">
        <Link to="/profile">
          <ArrowLeft className="mr-2 h-4 w-4" />
          返回个人主页
        </Link>
      </Button>

      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800">
            <Award className="h-12 w-12" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">{medal.title}</h1>
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
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{medal.summary}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {medal.tags.map((tag) => (
                <span key={tag} className="rounded-full border px-2 py-0.5 text-xs">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-4">
          <div className="rounded-md bg-muted p-4">
            <p className="text-xs font-medium text-muted-foreground">具体情节</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-7">{medal.detail}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md bg-muted p-4">
              <p className="text-xs font-medium text-muted-foreground">获得时间</p>
              <p className="mt-2 text-sm">{formatDate(medal.createdAt)}</p>
            </div>
            <div className="rounded-md bg-muted p-4">
              <p className="text-xs font-medium text-muted-foreground">生成来源</p>
              <p className="mt-2 text-sm">{medal.source === "agent" ? "Agent 生成" : "本地规则生成"}</p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3 border-t pt-5">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              updateVisibility(medal.id, medal.visibility === "public" ? "private" : "public")
            }
          >
            {medal.visibility === "public" ? (
              <>
                <EyeOff className="mr-2 h-4 w-4" />
                设为私密
              </>
            ) : (
              <>
                <Eye className="mr-2 h-4 w-4" />
                设为公开
              </>
            )}
          </Button>
          <Button type="button" variant="outline" onClick={handleDelete}>
            <Trash2 className="mr-2 h-4 w-4" />
            删除奖章
          </Button>
        </div>
      </div>
    </div>
  );
}

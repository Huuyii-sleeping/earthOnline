import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Award, Eye, EyeOff, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getMedal,
  updateMedal,
  regenerateMeaning,
  listMedalVersions,
} from "@/features/medals/medalApi";
import { useMedalStore } from "@/features/medals/medalStore";
import type { Medal, MedalVersion } from "@earth-online/shared";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

const memoryWeightLabels: Record<string, string> = {
  light: "轻盈记忆",
  medium: "有意义的经历",
  heavy: "重要人生节点",
};

export default function MedalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const removeMedal = useMedalStore((state) => state.removeMedal);

  const [medal, setMedal] = useState<Medal | null>(null);
  const [versions, setVersions] = useState<MedalVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    loadMedal(id);
  }, [id]);

  const loadMedal = async (medalId: string) => {
    setLoading(true);
    setError(null);
    try {
      const [medalData, versionData] = await Promise.all([
        getMedal(medalId),
        listMedalVersions(medalId).catch(() => []),
      ]);
      setMedal(medalData);
      setVersions(versionData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!medal) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="glass-card p-6">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full text-muted-foreground">
            <Award className="h-10 w-10" />
          </div>
          <h1 className="mt-4 text-xl font-semibold">没有找到这枚奖章</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            它可能已经被删除，或者只存在于其他浏览器。
          </p>
          <Button asChild className="mt-6">
            <Link to="/profile">返回个人主页</Link>
          </Button>
        </div>
      </div>
    );
  }

  const handleToggleVisibility = async () => {
    if (!medal) return;
    try {
      const updated = await updateMedal(medal.id, {
        visibility: medal.visibility === "public" ? "private" : "public",
      });
      setMedal(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新失败");
    }
  };

  const handleRegenerate = async () => {
    if (!medal || isRegenerating) return;
    setIsRegenerating(true);
    setError(null);
    try {
      const updated = await regenerateMeaning(medal.id);
      setMedal(updated);
      const newVersions = await listMedalVersions(medal.id);
      setVersions(newVersions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "重生成失败");
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleDelete = () => {
    if (!medal) return;
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

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="glass-card p-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full text-primary">
            <Award className="h-12 w-12" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">{medal.title}</h1>
              <span className="glass-subtle inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-muted-foreground">
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
              {medal.edited_by_user && (
                <span className="glass-subtle rounded-full px-2 py-0.5 text-xs text-primary">
                  已编辑
                </span>
              )}
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{medal.short_reason}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="glass-subtle rounded-full px-2 py-0.5 text-xs">
                {memoryWeightLabels[medal.memory_weight] || medal.memory_weight}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-4">
          <div className="glass-subtle rounded-lg p-4">
            <p className="text-xs font-medium text-muted-foreground">获得时间</p>
            <p className="mt-2 text-sm">{formatDate(medal.created_at)}</p>
          </div>

          {medal.image_url && (
            <div className="glass-subtle rounded-lg p-4">
              <p className="text-xs font-medium text-muted-foreground">奖章图片</p>
              <img
                src={medal.image_url}
                alt={medal.title}
                className="mt-2 max-h-48 rounded-lg border"
              />
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-wrap gap-3 border-t pt-5">
          <Button type="button" variant="outline" onClick={handleToggleVisibility}>
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
          <Button
            type="button"
            variant="outline"
            onClick={handleRegenerate}
            disabled={isRegenerating}
          >
            {isRegenerating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            意义重生成
          </Button>
          <Button type="button" variant="outline" onClick={handleDelete}>
            <Trash2 className="mr-2 h-4 w-4" />
            删除奖章
          </Button>
        </div>
      </div>

      {/* 版本历史 */}
      {versions.length > 0 && (
        <div className="glass-card p-6">
          <h2 className="text-sm font-semibold">版本历史</h2>
          <div className="mt-4 space-y-3">
            {versions.map((version) => (
              <div
                key={version.id}
                className={`rounded-md border p-3 ${
                  medal.current_version_id === version.id
                    ? "border-primary bg-primary/5"
                    : "border-border"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{version.title}</span>
                    <span className="glass-subtle rounded-full px-2 py-0.5 text-xs text-muted-foreground">
                      {version.version_type === "initial"
                        ? "初始版本"
                        : version.version_type === "user_edit"
                          ? "用户编辑"
                          : version.version_type === "meaning_regeneration"
                            ? "意义重生成"
                            : version.version_type}
                    </span>
                    {medal.current_version_id === version.id && (
                      <span className="glass-subtle rounded-full px-2 py-0.5 text-xs text-primary">
                        当前版本
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(version.created_at)}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{version.short_reason}</p>
                {version.meaning_focus && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    意义重心：{version.meaning_focus}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

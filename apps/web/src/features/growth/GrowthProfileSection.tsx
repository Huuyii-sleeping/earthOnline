import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Lightbulb, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { AxiosError } from "axios";
import { Button } from "@/components/ui/button";
import {
  getGrowthProfile,
  listGrowthInsights,
  refreshGrowthProfile,
  type GrowthProfile,
} from "@/features/growth/growthApi";

// isProfileReady is a type guard so the JSX below can safely access profile
// fields without re-checking for undefined on every line.
function isProfileReady(profile: GrowthProfile | undefined): profile is GrowthProfile {
  if (!profile) return false;
  return Boolean(profile.summary_text) || profile.trait_keywords.length > 0;
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AxiosError) {
    const apiError = error.response?.data as { error?: string; detail?: string } | undefined;
    return apiError?.error ?? apiError?.detail ?? fallback;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

const triggerLabels: Record<string, string> = {
  scheduled: "自动",
  manual: "手动",
  medal_generated: "奖章触发",
  stage_summary_generated: "阶段总结触发",
};

export function GrowthProfileSection() {
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ["growth-profile"],
    queryFn: getGrowthProfile,
  });

  const insightsQuery = useQuery({
    queryKey: ["growth-insights"],
    queryFn: () => listGrowthInsights(1, 5),
  });

  const refreshMutation = useMutation({
    mutationFn: () => refreshGrowthProfile("all"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["growth-profile"] });
      queryClient.invalidateQueries({ queryKey: ["growth-insights"] });
    },
  });

  const profile = profileQuery.data;
  const insights = insightsQuery.data?.data ?? [];
  const refreshing = refreshMutation.isPending;

  return (
    <section className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Brain className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">成长档案</h2>
            <p className="text-xs text-muted-foreground">
              {profile?.last_refreshed_at
                ? `最近更新于 ${formatDateTime(profile.last_refreshed_at)}`
                : "基于经历奖章与阶段回顾沉淀的长期画像"}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          刷新画像
        </Button>
      </div>

      {refreshMutation.error && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {extractErrorMessage(refreshMutation.error, "刷新失败，请稍后再试")}
        </div>
      )}

      {profileQuery.isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isProfileReady(profile) ? (
        <div className="mt-5 space-y-5">
          {profile?.summary_text && (
            <p className="text-sm leading-7 text-foreground/90">{profile.summary_text}</p>
          )}

          {profile.trait_keywords.length > 0 && (
            <KeywordGroup title="人格特质" keywords={profile.trait_keywords} />
          )}
          {profile.growth_keywords.length > 0 && (
            <KeywordGroup title="成长关键词" keywords={profile.growth_keywords} />
          )}

          {profile.experience_types.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">经历类型分布</h3>
              <div className="space-y-2">
                {profile.experience_types.map((t) => (
                  <div key={t.type} className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">{t.type}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary/60"
                        style={{ width: `${Math.min(100, Math.round(t.weight * 100))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {profile.emotion_trends.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">情绪轨迹</h3>
              <div className="space-y-2">
                {profile.emotion_trends.map((trend, idx) => (
                  <div key={idx} className="rounded-lg bg-muted/50 p-3">
                    <p className="text-xs font-medium text-foreground">{trend.label}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{trend.summary}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <EmptyProfile />
      )}

      {insights.length > 0 && (
        <div className="mt-6 border-t pt-5">
          <div className="mb-3 flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-medium">近期洞察</h3>
          </div>
          <div className="space-y-3">
            {insights.map((insight) => (
              <article key={insight.id} className="rounded-lg border p-4">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold">{insight.title}</h4>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {triggerLabels[insight.trigger] ?? insight.trigger}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  {insight.summary_text}
                </p>
                {insight.keywords.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {insight.keywords.map((kw) => (
                      <span
                        key={kw}
                        className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function KeywordGroup({ title, keywords }: { title: string; keywords: string[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-muted-foreground">{title}</h3>
      <div className="flex flex-wrap gap-2">
        {keywords.map((kw) => (
          <span key={kw} className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">
            {kw}
          </span>
        ))}
      </div>
    </div>
  );
}

function EmptyProfile() {
  return (
    <div className="mt-5 flex flex-col items-center justify-center rounded-lg border border-dashed py-10 text-center">
      <Sparkles className="h-8 w-8 text-muted-foreground" />
      <p className="mt-3 text-sm font-medium">还没有成长画像</p>
      <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
        继续记录经历、生成奖章和阶段回顾后，点击「刷新画像」让 Agent 帮你沉淀长期成长档案。
      </p>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

import { useState } from "react";
import { Award, CalendarDays, Inbox, Loader2, Sparkles } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  generateStageSummary,
  listStageSummaries,
  type PeriodType,
  type StageSummary,
} from "@/features/stage/stageApi";

const periodLabels: Record<PeriodType, string> = {
  week: "周回顾",
  month: "月回顾",
};

const weightLabels: Record<StageSummary["memory_weight"], string> = {
  light: "平稳日常",
  medium: "明显主题",
  heavy: "重要阶段",
};

export default function StageSummariesPage() {
  const queryClient = useQueryClient();
  const [periodType, setPeriodType] = useState<PeriodType>("week");

  const summariesQuery = useQuery({
    queryKey: ["stage-summaries", periodType],
    queryFn: () => listStageSummaries(periodType),
  });

  const generateMutation = useMutation({
    mutationFn: () => generateStageSummary(periodType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stage-summaries"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
  });

  const summaries = summariesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="glass-card flex flex-col gap-4 rounded-2xl p-6 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Award className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">阶段回顾</h1>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            把一周或一个月里的经历汇总成阶段总结和阶段大奖章。自动生成会遵循 Agent
            设置里的主动程度。
          </p>
        </div>
        <Button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          className="self-start md:self-auto"
        >
          {generateMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          生成本{periodType === "week" ? "周" : "月"}回顾
        </Button>
      </div>

      <Tabs value={periodType} onValueChange={(value) => setPeriodType(value as PeriodType)}>
        <TabsList>
          <TabsTrigger value="week">周回顾</TabsTrigger>
          <TabsTrigger value="month">月回顾</TabsTrigger>
        </TabsList>
      </Tabs>

      {generateMutation.error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          生成失败：这个周期可能还没有可总结的经历，或 Agent 服务暂时不可用。
        </div>
      )}

      {summariesQuery.isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : summariesQuery.error ? (
        <EmptyState title="加载失败" hint="阶段回顾暂时无法加载，请稍后重试" />
      ) : summaries.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {summaries.map((summary) => (
            <StageSummaryCard key={summary.id} summary={summary} />
          ))}
        </div>
      ) : (
        <EmptyState
          title={`还没有${periodLabels[periodType]}`}
          hint="记录几段经历后，可以手动生成，也可以等待 Worker 定时生成。"
        />
      )}
    </div>
  );
}

function StageSummaryCard({ summary }: { summary: StageSummary }) {
  const highlights = Array.isArray(summary.highlights) ? summary.highlights : [];

  return (
    <article className="glass-card rounded-2xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {periodLabels[summary.period_type]} · {weightLabels[summary.memory_weight]}
          </p>
          <h2 className="mt-2 text-xl font-semibold">{summary.title}</h2>
        </div>
        <div className="glass-subtle rounded-full px-3 py-1 text-xs text-muted-foreground">
          {summary.trigger === "scheduled" ? "自动生成" : "手动生成"}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5" />
        <span>
          {formatDate(summary.period_start)} - {formatDate(summary.period_end)}
        </span>
        <span>·</span>
        <span>{summary.experience_count} 段经历</span>
      </div>

      <p className="mt-4 text-sm leading-7 text-foreground/90">{summary.summary_text}</p>

      {summary.story && (
        <p className="mt-3 glass-subtle rounded-lg p-3 text-sm leading-6 text-muted-foreground">
          {summary.story}
        </p>
      )}

      {highlights.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {highlights.map((highlight) => (
            <span key={highlight} className="glass-subtle rounded-full px-3 py-1 text-xs">
              {highlight}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed py-20 text-muted-foreground">
      <Inbox className="h-12 w-12" />
      <p className="mt-4 text-lg font-medium">{title}</p>
      <p className="mt-1 text-sm">{hint}</p>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

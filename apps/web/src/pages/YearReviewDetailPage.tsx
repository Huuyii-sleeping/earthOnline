import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Award, BookOpen, ChevronLeft, Loader2, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { deleteAnnualReview, getAnnualReview } from "@/features/year-review/yearReviewApi";

const milestoneTypeLabels: Record<string, string> = {
  action: "行动",
  emotion: "情绪",
  growth: "成长",
  relation: "关系",
};

export default function YearReviewDetailPage() {
  const { year } = useParams<{ year: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const yearNum = parseInt(year ?? "0", 10);

  const reviewQuery = useQuery({
    queryKey: ["annual-review", yearNum],
    queryFn: () => getAnnualReview(yearNum),
    enabled: yearNum > 0,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteAnnualReview(yearNum),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["annual-reviews"] });
      navigate("/year-review");
    },
  });

  if (reviewQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (reviewQuery.error || !reviewQuery.data) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
          <BookOpen className="h-10 w-10 text-muted-foreground" />
          <p className="mt-4 text-sm font-medium">{yearNum} 年还没有生成年度回顾</p>
          <Button asChild className="mt-4" size="sm">
            <Link to="/year-review">去生成</Link>
          </Button>
        </div>
      </div>
    );
  }

  const review = reviewQuery.data;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/year-review">
            <ChevronLeft className="mr-1 h-4 w-4" />
            返回列表
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          disabled={deleteMutation.isPending}
          onClick={() => {
            if (confirm(`确认删除 ${review.year} 年回顾？删除后可以重新生成。`)) {
              deleteMutation.mutate();
            }
          }}
        >
          <Trash2 className="mr-1 h-4 w-4" />
          删除
        </Button>
      </div>

      {/* 年度封面 */}
      <header className="space-y-4 text-center">
        <div className="text-4xl font-bold text-primary sm:text-5xl">{review.year}</div>
        <h1 className="text-xl font-bold sm:text-2xl">{review.title}</h1>
        {review.annual_themes.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {review.annual_themes.map((theme) => (
              <span
                key={theme}
                className="rounded-full bg-primary/10 px-3 py-1 text-sm text-primary"
              >
                {theme}
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground sm:gap-4">
          <span className="flex items-center gap-1">
            <Award className="h-4 w-4" />
            {review.medal_count} 枚奖章
          </span>
          <span className="flex items-center gap-1">
            <BookOpen className="h-4 w-4" />
            {review.stage_summary_count} 段总结
          </span>
          <span>{review.experience_count} 段经历</span>
        </div>
      </header>

      {/* 长叙事正文 */}
      {review.narrative && (
        <section className="rounded-lg border bg-card p-6 shadow-sm">
          <p className="whitespace-pre-line text-sm leading-8 text-foreground/90">
            {review.narrative}
          </p>
        </section>
      )}

      {/* 里程碑奖章 */}
      {review.milestone_medals.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">年度里程碑</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {review.milestone_medals.map((medal, idx) => (
              <div key={idx} className="rounded-lg border bg-card p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                      <Award className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold">{medal.title}</h3>
                      <span className="text-xs text-muted-foreground">
                        {milestoneTypeLabels[medal.milestoneType] ?? medal.milestoneType}
                      </span>
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{medal.shortReason}</p>
                {medal.agentNote && (
                  <p className="mt-2 rounded-md bg-muted/50 p-2 text-xs italic leading-5 text-foreground/70">
                    {medal.agentNote}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 成长弧线 */}
      {review.growth_arc && (
        <section className="rounded-lg border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">成长弧线</h2>
          <div className="space-y-4">
            <div className="rounded-md bg-muted/30 p-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">年初</p>
              <p className="text-sm leading-6">{review.growth_arc.startState}</p>
            </div>
            {review.growth_arc.turningPoints.length > 0 && (
              <div className="space-y-2">
                {review.growth_arc.turningPoints.map((tp, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-primary" />
                    <p className="text-sm leading-6">{tp}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="rounded-md bg-primary/5 p-3">
              <p className="mb-1 text-xs font-medium text-primary">年末</p>
              <p className="text-sm leading-6">{review.growth_arc.endState}</p>
            </div>
          </div>
        </section>
      )}

      {/* 情绪轨迹 */}
      {review.emotion_arc.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">情绪轨迹</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {review.emotion_arc.map((entry, idx) => (
              <div key={idx} className="rounded-lg border bg-card p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {entry.period}
                  </span>
                  <span className="text-sm font-medium text-primary">{entry.emotion}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{entry.summary}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 关键词演化 */}
      {review.keyword_evolution && (
        <section className="rounded-lg border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">关键词演化</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">年初</p>
              <div className="flex flex-wrap gap-1.5">
                {review.keyword_evolution.earlierKeywords.map((kw) => (
                  <span
                    key={kw}
                    className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">年末</p>
              <div className="flex flex-wrap gap-1.5">
                {review.keyword_evolution.laterKeywords.map((kw) => (
                  <span
                    key={kw}
                    className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          </div>
          {review.keyword_evolution.shift && (
            <p className="mt-4 border-t pt-3 text-xs leading-5 text-muted-foreground">
              {review.keyword_evolution.shift}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

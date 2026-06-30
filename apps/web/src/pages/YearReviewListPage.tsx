import { useState } from "react";
import { Award, BookOpen, Inbox, Loader2, Sparkles, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { AxiosError } from "axios";
import { Button } from "@/components/ui/button";
import {
  deleteAnnualReview,
  generateAnnualReview,
  listAnnualReviews,
  type AnnualReview,
} from "@/features/year-review/yearReviewApi";

const triggerLabels: Record<string, string> = {
  manual: "手动",
  scheduled: "自动",
  year_end: "年终",
};

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AxiosError) {
    const apiError = error.response?.data as { error?: string; detail?: string } | undefined;
    return apiError?.error ?? apiError?.detail ?? fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export default function YearReviewListPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [generateYear, setGenerateYear] = useState(new Date().getFullYear());
  const [dialogOpen, setDialogOpen] = useState(false);

  const reviewsQuery = useQuery({
    queryKey: ["annual-reviews"],
    queryFn: () => listAnnualReviews(1, 50),
  });

  const generateMutation = useMutation({
    mutationFn: (year: number) => generateAnnualReview(year),
    onSuccess: (review) => {
      queryClient.invalidateQueries({ queryKey: ["annual-reviews"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
      queryClient.invalidateQueries({ queryKey: ["growth-insights"] });
      setDialogOpen(false);
      navigate(`/year-review/${review.year}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (year: number) => deleteAnnualReview(year),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["annual-reviews"] });
    },
  });

  const reviews = reviewsQuery.data?.data ?? [];
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <BookOpen className="h-6 w-6 text-primary" />
            年度回顾
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">回望每一年走过的心路历程</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="self-start sm:self-auto">
          <Sparkles className="mr-2 h-4 w-4" />
          生成年度回顾
        </Button>
      </div>

      {/* 生成对话框 */}
      {dialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setDialogOpen(false)}
        >
          <div
            className="glass-strong w-full max-w-md rounded-lg p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">选择年份</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              选择要生成年度回顾的年份。如果该年已有回顾，需要先删除才能重新生成。
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {years.map((y) => (
                <Button
                  key={y}
                  variant={generateYear === y ? "default" : "outline"}
                  size="sm"
                  onClick={() => setGenerateYear(y)}
                  className="shrink-0"
                >
                  {y}
                </Button>
              ))}
            </div>
            {generateMutation.error && (
              <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {extractErrorMessage(generateMutation.error, "生成失败，请稍后再试")}
              </div>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
                取消
              </Button>
              <Button
                size="sm"
                onClick={() => generateMutation.mutate(generateYear)}
                disabled={generateMutation.isPending}
              >
                {generateMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                生成 {generateYear} 年回顾
              </Button>
            </div>
          </div>
        </div>
      )}

      {reviewsQuery.isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : reviews.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <AnnualReviewCard
              key={review.id}
              review={review}
              onDelete={() => {
                if (confirm(`确认删除 ${review.year} 年回顾？删除后可以重新生成。`)) {
                  deleteMutation.mutate(review.year);
                }
              }}
              deleting={deleteMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AnnualReviewCard({
  review,
  onDelete,
  deleting,
}: {
  review: AnnualReview;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <div className="glass-card group relative overflow-hidden p-6 transition-shadow hover:shadow-md">
      <Link to={`/year-review/${review.year}`} className="block">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <span className="text-3xl font-bold text-primary">{review.year}</span>
              <span className="glass-subtle rounded-full px-2 py-0.5 text-xs text-muted-foreground">
                {triggerLabels[review.trigger] ?? review.trigger}
              </span>
            </div>
            <h3 className="mt-2 text-lg font-semibold">{review.title}</h3>
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
              {review.narrative}
            </p>
            {review.annual_themes.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {review.annual_themes.map((theme) => (
                  <span
                    key={theme}
                    className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary"
                  >
                    {theme}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Award className="h-3.5 w-3.5" />
                {review.medal_count} 枚奖章
              </span>
              <span className="flex items-center gap-1">
                <BookOpen className="h-3.5 w-3.5" />
                {review.stage_summary_count} 段总结
              </span>
              <span>{review.experience_count} 段经历</span>
            </div>
          </div>
        </div>
      </Link>
      <button
        onClick={onDelete}
        disabled={deleting}
        className="absolute right-4 top-4 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
        title="删除"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
      <Inbox className="h-10 w-10 text-muted-foreground" />
      <p className="mt-4 text-sm font-medium">还没有年度回顾</p>
      <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
        在年末或全年任意时间，点击「生成年度回顾」，Agent
        会从你的奖章、阶段总结和成长画像中提取年度叙事。
      </p>
    </div>
  );
}

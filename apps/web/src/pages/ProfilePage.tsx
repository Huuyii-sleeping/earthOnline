import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Award, Clock, Grid, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getMyMedals, getMyProfile } from "@/features/profile/profileApi";
import { listFollowers, listFollowing } from "@/features/social/socialApi";
import { GrowthProfileSection } from "@/features/growth/GrowthProfileSection";
import type { MedalWithVersion } from "@earth-online/shared";

const memoryWeightLabels: Record<string, string> = {
  light: "轻盈记忆",
  medium: "有意义的经历",
  heavy: "重要人生节点",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function visibilityLabel(visibility: string) {
  if (visibility === "public") return "公开";
  if (visibility === "friends") return "好友可见";
  return "私密";
}

export default function ProfilePage() {
  const profileQuery = useQuery({
    queryKey: ["my-profile"],
    queryFn: getMyProfile,
  });
  const medalsQuery = useQuery({
    queryKey: ["my-medals"],
    queryFn: getMyMedals,
  });
  const followingQuery = useQuery({
    queryKey: ["my-following"],
    queryFn: listFollowing,
  });
  const followersQuery = useQuery({
    queryKey: ["my-followers"],
    queryFn: listFollowers,
  });

  const profile = profileQuery.data;
  const medals = medalsQuery.data ?? [];
  const followingCount = followingQuery.data?.length ?? 0;
  const followerCount = followersQuery.data?.length ?? 0;

  // 时间线按获得时间倒序排列。依赖 React Query 返回的稳定引用，避免每次渲染重排。
  const timelineMedals = useMemo(
    () =>
      (medalsQuery.data ?? [])
        .slice()
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [medalsQuery.data],
  );

  const medalsLoading = medalsQuery.isLoading;
  const medalsError = medalsQuery.error;

  return (
    <div className="space-y-8">
      {/* 个人信息卡片 */}
      <div className="glass-card p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={profile.nickname}
                className="h-16 w-16 rounded-full border object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-xl font-bold text-primary-foreground">
                {profile?.nickname?.[0]?.toUpperCase() ?? "U"}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-xl font-semibold">{profile?.nickname ?? "个人主页"}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {profile?.bio ?? "这个人还没有留下简介"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {profile ? `已收藏 ${profile.medal_count} 枚经历奖章` : "加载中…"}
              </p>
              <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
                <span>
                  <span className="font-semibold text-foreground">{followingCount}</span> 关注
                </span>
                <span>
                  <span className="font-semibold text-foreground">{followerCount}</span> 粉丝
                </span>
              </div>
            </div>
          </div>
          <Button asChild>
            <Link to="/create">
              <Plus className="mr-2 h-4 w-4" />
              记录经历
            </Link>
          </Button>
        </div>
      </div>

      {/* 成长档案 */}
      <GrowthProfileSection />

      {/* 奖章墙 / 时间线 */}
      <Tabs defaultValue="wall" className="w-full">
        <TabsList>
          <TabsTrigger value="wall">
            <Grid className="mr-2 h-4 w-4" />
            奖章墙
          </TabsTrigger>
          <TabsTrigger value="timeline">
            <Clock className="mr-2 h-4 w-4" />
            时间线
          </TabsTrigger>
        </TabsList>

        {/* 奖章墙 */}
        <TabsContent value="wall">
          {medalsLoading ? (
            <LoadingState />
          ) : medalsError ? (
            <ErrorState message="加载奖章失败，请稍后重试" />
          ) : medals.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
              {medals.map((medal) => (
                <MedalWallCard key={medal.id} medal={medal} />
              ))}
            </div>
          ) : (
            <EmptyState />
          )}
        </TabsContent>

        {/* 时间线 */}
        <TabsContent value="timeline">
          {medalsLoading ? (
            <LoadingState />
          ) : medalsError ? (
            <ErrorState message="加载奖章失败，请稍后重试" />
          ) : timelineMedals.length > 0 ? (
            <div className="space-y-3 py-4">
              {timelineMedals.map((medal) => (
                <MedalTimelineRow key={`timeline-${medal.id}`} medal={medal} />
              ))}
            </div>
          ) : (
            <EmptyState />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MedalWallCard({ medal }: { medal: MedalWithVersion }) {
  return (
    <Link to={`/medals/${medal.id}`} className="glass-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-full text-primary">
          <Award className="h-7 w-7" />
        </div>
        <span className="glass-subtle inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-muted-foreground">
          {visibilityLabel(medal.visibility)}
        </span>
      </div>
      <h3 className="mt-4 font-semibold">{medal.title}</h3>
      <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
        {medal.short_reason}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <span className="glass-subtle rounded-full px-2 py-0.5 text-xs">
          {memoryWeightLabels[medal.memory_weight] ?? medal.memory_weight}
        </span>
      </div>
    </Link>
  );
}

function MedalTimelineRow({ medal }: { medal: MedalWithVersion }) {
  return (
    <Link to={`/medals/${medal.id}`} className="glass-card flex gap-4 p-4">
      <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground">
        <Clock className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{medal.title}</p>
          <span className="glass-subtle inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs text-muted-foreground">
            {visibilityLabel(medal.visibility)}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{formatDate(medal.created_at)}</p>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
          {medal.short_reason}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="glass-subtle rounded-full px-2 py-0.5 text-xs">
            {memoryWeightLabels[medal.memory_weight] ?? medal.memory_weight}
          </span>
        </div>
      </div>
    </Link>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
      <Award className="h-10 w-10" />
      <p className="mt-3 text-sm">{message}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="glass-card flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full text-primary">
        <Award className="h-8 w-8" />
      </div>
      <h3 className="mt-4 text-lg font-semibold">还没有任何经历奖章</h3>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        和你的 Agent 聊聊最近发生的事，让它帮你把重要的经历铸成一枚奖章，留在这里慢慢回看。
      </p>
      <Button asChild className="mt-6">
        <Link to="/create">
          <Plus className="mr-2 h-4 w-4" />
          记录经历
        </Link>
      </Button>
    </div>
  );
}

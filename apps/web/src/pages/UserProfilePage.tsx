import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Loader2, UserCheck, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/useAuth";
import { getUserMedals, getUserProfile } from "@/features/profile/profileApi";
import {
  followUser,
  listFollowing,
  requestFriend,
  unfollowUser,
} from "@/features/social/socialApi";
import type { MedalWithVersion } from "@earth-online/shared";

const memoryWeightLabels: Record<string, string> = {
  light: "轻盈记忆",
  medium: "有意义的经历",
  heavy: "重要人生节点",
};

export default function UserProfilePage() {
  const { id = "" } = useParams();
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  const isSelf = userId === id;

  const profileQuery = useQuery({
    queryKey: ["user-profile", id],
    queryFn: () => getUserProfile(id),
    enabled: !!id,
  });
  const medalsQuery = useQuery({
    queryKey: ["user-medals", id],
    queryFn: () => getUserMedals(id),
    enabled: !!id,
  });
  // 通过「我关注的人」列表判断当前是否已关注该用户。
  const followingQuery = useQuery({
    queryKey: ["my-following"],
    queryFn: listFollowing,
    enabled: !isSelf,
  });

  const isFollowing = (followingQuery.data ?? []).some((u) => u.id === id);

  const followMutation = useMutation({
    mutationFn: () => (isFollowing ? unfollowUser(id) : followUser(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-following"] });
    },
  });

  const friendMutation = useMutation({
    mutationFn: () => requestFriend(id),
  });

  const profile = profileQuery.data;
  const medals = medalsQuery.data ?? [];

  if (profileQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (profileQuery.error || !profile) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Users className="h-10 w-10" />
        <p className="mt-3 text-sm">用户不存在或加载失败</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="glass-card p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={profile.nickname}
                className="glass-subtle h-16 w-16 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-xl font-bold text-primary-foreground">
                {profile.nickname?.[0]?.toUpperCase() ?? "U"}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-xl font-semibold">{profile.nickname}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {profile.bio ?? "这个人还没有留下简介"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {`公开了 ${profile.medal_count} 枚经历奖章`}
              </p>
            </div>
          </div>

          {!isSelf && (
            <div className="flex gap-2">
              <Button
                variant={isFollowing ? "outline" : "default"}
                onClick={() => followMutation.mutate()}
                disabled={followMutation.isPending}
              >
                {isFollowing ? (
                  <>
                    <UserCheck className="mr-1.5 h-4 w-4" />
                    已关注
                  </>
                ) : (
                  <>
                    <UserPlus className="mr-1.5 h-4 w-4" />
                    关注
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => friendMutation.mutate()}
                disabled={friendMutation.isPending || friendMutation.isSuccess}
              >
                {friendMutation.isSuccess ? "申请已发送" : "加好友"}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div>
        <h2 className="mb-4 text-lg font-semibold">公开奖章</h2>
        {medalsQuery.isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : medals.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {medals.map((medal) => (
              <UserMedalCard key={medal.id} medal={medal} />
            ))}
          </div>
        ) : (
          <div className="glass-card flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Award className="h-10 w-10" />
            <p className="mt-3 text-sm">还没有公开的奖章</p>
          </div>
        )}
      </div>
    </div>
  );
}

function UserMedalCard({ medal }: { medal: MedalWithVersion }) {
  return (
    <Link to={`/medals/${medal.id}`} className="glass-card p-5">
      <div className="flex h-14 w-14 items-center justify-center rounded-full text-primary">
        <Award className="h-7 w-7" />
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

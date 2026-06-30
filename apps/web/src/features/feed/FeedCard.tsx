import { useState } from "react";
import { Link } from "react-router-dom";
import { Award, Hand, HeartHandshake, Sparkles, Star } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import type { FeedItem, InteractionType } from "@earth-online/shared";
import { createInteraction, deleteInteraction } from "@/features/social/socialApi";

const memoryWeightLabels: Record<string, string> = {
  light: "轻盈记忆",
  medium: "有意义的经历",
  heavy: "重要人生节点",
};

// 轻互动按钮配置，用更贴合经历成就的表达替代普通点赞。
const reactionConfig: {
  type: InteractionType;
  label: string;
  icon: typeof Hand;
}[] = [
  { type: "applaud", label: "为你鼓掌", icon: Hand },
  { type: "relate", label: "我也经历过", icon: HeartHandshake },
  { type: "brave", label: "这很勇敢", icon: Sparkles },
  { type: "memorable", label: "这值得记住", icon: Star },
];

export default function FeedCard({ item }: { item: FeedItem }) {
  // 本地维护互动状态，配合乐观更新，避免每次点击都等待网络往返。
  const [counts, setCounts] = useState<Partial<Record<InteractionType, number>>>(item.counts ?? {});
  const [reacted, setReacted] = useState<Set<InteractionType>>(
    new Set(item.viewer_reactions ?? []),
  );

  const mutation = useMutation({
    mutationFn: ({ type, active }: { type: InteractionType; active: boolean }) =>
      active ? deleteInteraction(item.medal_id, type) : createInteraction(item.medal_id, type),
    onSuccess: (data) => {
      // 以服务端返回的权威计数为准，纠正乐观更新可能的偏差。
      setCounts(data.counts ?? {});
      setReacted(new Set(data.viewer ?? []));
    },
  });

  function toggleReaction(type: InteractionType) {
    const active = reacted.has(type);

    // 乐观更新。
    setReacted((prev) => {
      const next = new Set(prev);
      if (active) next.delete(type);
      else next.add(type);
      return next;
    });
    setCounts((prev) => {
      const current = prev[type] ?? 0;
      return { ...prev, [type]: Math.max(0, current + (active ? -1 : 1)) };
    });

    mutation.mutate({ type, active });
  }

  return (
    <div className="glass-card p-4 sm:p-5">
      <Link to={`/medals/${item.medal_id}`} className="block">
        <div className="flex items-start gap-3 sm:gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full text-primary sm:h-14 sm:w-14">
            {item.image_url ? (
              <img src={item.image_url} alt={item.title} className="h-full w-full object-cover" />
            ) : (
              <Award className="h-7 w-7" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-semibold">{item.title}</h2>
              <span className="glass-subtle shrink-0 rounded-full px-2 py-0.5 text-xs">
                {memoryWeightLabels[item.memory_weight] ?? item.memory_weight}
              </span>
            </div>
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
              {item.short_reason}
            </p>
          </div>
        </div>
      </Link>

      {/* 作者（独立于奖章链接，便于跳转用户主页） */}
      {item.author?.id ? (
        <Link
          to={`/users/${item.author.id}`}
          className="mt-2 inline-block text-xs text-muted-foreground hover:underline"
        >
          by {item.author.nickname ?? "匿名"}
        </Link>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">by {item.author?.nickname ?? "匿名"}</p>
      )}

      {/* 轻互动 */}
      <div className="mt-4 flex flex-wrap gap-1.5 border-t border-[var(--glass-border)] pt-3 sm:gap-2 sm:pt-4">
        {reactionConfig.map(({ type, label, icon: Icon }) => {
          const active = reacted.has(type);
          const count = counts[type] ?? 0;
          // 仅禁用正在请求中的那一个按钮，其余按钮保持可点。
          const pending = mutation.isPending && mutation.variables?.type === type;
          return (
            <button
              key={type}
              type="button"
              onClick={() => toggleReaction(type)}
              disabled={pending}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-60 sm:px-3 ${
                active ? "border-amber-300 bg-amber-50 text-amber-800" : "hover:bg-muted/50"
              }`}
              aria-pressed={active}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{label}</span>
              {count > 0 && <span className="ml-0.5 tabular-nums">{count}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

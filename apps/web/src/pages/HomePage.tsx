import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Inbox, Loader2, PlusCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FeedTab } from "@earth-online/shared";
import { getFeed } from "@/features/feed/feedApi";
import FeedCard from "@/features/feed/FeedCard";

const feedTabs: { value: FeedTab; label: string }[] = [
  { value: "following", label: "关注" },
  { value: "latest", label: "最新" },
  { value: "popular", label: "热门" },
  { value: "similar", label: "相似" },
  { value: "for-you", label: "为你推荐" },
];

export default function HomePage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<FeedTab>("latest");

  const feedQuery = useQuery({
    queryKey: ["feed", activeTab],
    queryFn: () => getFeed(activeTab),
  });

  const items = feedQuery.data?.data ?? [];

  return (
    <div className="relative pb-20">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as FeedTab)} className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto">
          {feedTabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {feedTabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            {feedQuery.isLoading ? (
              <LoadingState />
            ) : feedQuery.error ? (
              <EmptyState title="加载失败" hint="社交流暂时无法加载，请稍后重试" />
            ) : items.length > 0 ? (
              <div className="grid gap-4 py-4 md:grid-cols-2">
                {items.map((item) => (
                  <FeedCard key={`${tab.value}-${item.medal_id}`} item={item} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="暂无内容"
                hint={
                  tab.value === "following"
                    ? "关注一些用户后，他们公开的奖章会出现在这里"
                    : "创建并公开你的第一枚经历奖章"
                }
              />
            )}
          </TabsContent>
        ))}
      </Tabs>

      <Button
        size="lg"
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg"
        onClick={() => navigate("/create")}
      >
        <PlusCircle className="h-6 w-6" />
      </Button>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
      <Inbox className="h-12 w-12" />
      <p className="mt-4 text-lg font-medium">{title}</p>
      <p className="mt-1 text-sm">{hint}</p>
    </div>
  );
}

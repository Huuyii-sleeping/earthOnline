import { Link, useNavigate } from "react-router-dom";
import { Award, Eye, Inbox, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMedalStore } from "@/features/medals/medalStore";

const feedTabs = [
  { value: "following", label: "关注" },
  { value: "latest", label: "最新" },
  { value: "hot", label: "热门" },
  { value: "similar", label: "相似" },
  { value: "recommend", label: "为你推荐" },
];

export default function HomePage() {
  const navigate = useNavigate();
  const publicMedals = useMedalStore((state) =>
    state.medals.filter((medal) => medal.visibility === "public"),
  );

  return (
    <div className="relative pb-20">
      <Tabs defaultValue="latest" className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto">
          {feedTabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {feedTabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            {publicMedals.length > 0 ? (
              <div className="grid gap-4 py-4 md:grid-cols-2">
                {publicMedals.map((medal) => (
                  <Link
                    key={`${tab.value}-${medal.id}`}
                    to={`/medals/${medal.id}`}
                    className="rounded-lg border bg-card p-5 shadow-sm transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800">
                        <Award className="h-7 w-7" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h2 className="font-semibold">{medal.title}</h2>
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            <Eye className="h-3 w-3" />
                            公开
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {medal.summary}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {medal.tags.map((tag) => (
                            <span key={tag} className="rounded-full border px-2 py-0.5 text-xs">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Inbox className="h-12 w-12" />
                <p className="mt-4 text-lg font-medium">暂无内容</p>
                <p className="mt-1 text-sm">创建并公开你的第一枚经历奖章</p>
              </div>
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

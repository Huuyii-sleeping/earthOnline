import { useNavigate } from "react-router-dom";
import { Home } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <h1 className="text-8xl font-bold text-muted-foreground">404</h1>
      <p className="mt-4 text-lg text-muted-foreground">页面不存在</p>
      <p className="mt-1 text-sm text-muted-foreground">你访问的页面不存在或已被移除</p>
      <Button className="mt-8" onClick={() => navigate("/", { replace: true })}>
        <Home className="mr-2 h-4 w-4" />
        返回首页
      </Button>
    </div>
  );
}

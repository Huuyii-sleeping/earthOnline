import { useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { Award, Bell, Bot, Home, LogOut, Menu, PlusCircle, User, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/useAuth";
import { getUnreadCount } from "@/features/notifications/notificationApi";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/app", label: "首页", icon: Home },
  { to: "/create", label: "创建经历", icon: PlusCircle },
  { to: "/stage-summaries", label: "阶段回顾", icon: Award },
  { to: "/profile", label: "个人主页", icon: User },
  { to: "/notifications", label: "通知", icon: Bell },
  { to: "/settings/agent", label: "Agent 设置", icon: Bot },
];

export default function AppLayout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { nickname, logout } = useAuth();
  const navigate = useNavigate();

  // 未读通知数，用于在导航上显示红点。每 60s 轮询一次。
  const unreadQuery = useQuery({
    queryKey: ["notifications-unread"],
    queryFn: getUnreadCount,
    refetchInterval: 60_000,
  });
  const unread = unreadQuery.data ?? 0;

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* 顶部导航栏 */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          {/* 品牌名 */}
          <NavLink to="/app" className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <Bot className="h-5 w-5 text-primary" />
            <span>经历成就官</span>
          </NavLink>

          {/* 桌面端导航 */}
          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/app"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )
                }
              >
                <span className="relative">
                  <item.icon className="h-4 w-4" />
                  {item.to === "/notifications" && unread > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </span>
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* 右侧用户信息 */}
          <div className="hidden items-center gap-3 md:flex">
            <span className="text-sm text-muted-foreground">{nickname}</span>
            <Button variant="ghost" size="icon" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>

          {/* 移动端汉堡菜单按钮 */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>

        {/* 移动端菜单 */}
        {mobileMenuOpen && (
          <div className="border-t md:hidden">
            <nav className="mx-auto flex max-w-6xl flex-col px-4 py-2">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/app"}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )
                  }
                >
                  <span className="relative">
                    <item.icon className="h-4 w-4" />
                    {item.to === "/notifications" && unread > 0 && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </span>
                  {item.label}
                </NavLink>
              ))}
              <div className="mt-2 flex items-center gap-3 border-t pt-2">
                <span className="px-3 text-sm text-muted-foreground">{nickname}</span>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                >
                  <LogOut className="h-4 w-4" />
                  退出登录
                </button>
              </div>
            </nav>
          </div>
        )}
      </header>

      {/* 内容区域 */}
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}

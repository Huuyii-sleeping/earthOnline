import { useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { Award, Bell, Bot, BookOpen, Home, LogOut, Menu, PlusCircle, User, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useAuth } from "@/features/auth/useAuth";
import { getUnreadCount } from "@/features/notifications/notificationApi";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/app", label: "首页", icon: Home },
  { to: "/create", label: "创建经历", icon: PlusCircle },
  { to: "/stage-summaries", label: "阶段回顾", icon: Award },
  { to: "/year-review", label: "年度回顾", icon: BookOpen },
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
    <div className="relative z-10 min-h-screen">
      {/* 顶部导航栏 — glassmorphism */}
      <header className="glass-nav sticky top-0 z-50 w-full pt-safe">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          {/* 品牌名 */}
          <NavLink to="/app" className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <Bot className="h-5 w-5 text-primary" />
            <span className="hidden sm:inline">经历成就官</span>
          </NavLink>

          {/* 桌面端导航 — lg 以上显示，避免 7 个菜单项在中等宽度溢出 */}
          <nav className="hidden items-center gap-0.5 lg:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/app"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-all duration-200",
                    isActive
                      ? "glass-strong text-foreground"
                      : "text-muted-foreground hover:text-foreground",
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

          {/* 右侧：主题切换 + 用户信息 */}
          <div className="hidden items-center gap-3 lg:flex">
            <ThemeToggle />
            <span className="text-sm text-muted-foreground">{nickname}</span>
            <Button variant="ghost" size="icon" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>

          {/* 移动端右侧：导航菜单按钮 + 主题切换 */}
          <div className="flex items-center gap-2 lg:hidden">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="gap-1.5 rounded-full px-3"
              style={{
                border: "1px solid var(--glass-border)",
                background: "var(--glass-bg)",
                backdropFilter: "blur(24px) saturate(150%)",
                WebkitBackdropFilter: "blur(24px) saturate(150%)",
              }}
              aria-label="打开导航菜单"
            >
              {mobileMenuOpen ? (
                <X className="h-4 w-4 text-foreground" />
              ) : (
                <Menu className="h-4 w-4 text-foreground" />
              )}
              <span className="text-sm font-medium text-foreground">菜单</span>
            </Button>
            <ThemeToggle />
          </div>
        </div>

        {/* 移动端菜单 — 玻璃态下拉面板 */}
        {mobileMenuOpen && (
          <>
            {/* 遮罩层，点击关闭 */}
            <div
              className="fixed inset-0 top-14 z-40 bg-black/30 backdrop-blur-sm lg:hidden"
              onClick={() => setMobileMenuOpen(false)}
            />
            {/* 菜单面板 — 不透明背景，确保移动端文字清晰 */}
            <div className="absolute left-0 right-0 top-14 z-50 border-t border-border bg-background shadow-xl lg:hidden">
              <nav className="mx-auto flex max-w-6xl flex-col px-4 py-3">
                {navItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/app"}
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                        isActive
                          ? "glass-strong text-foreground"
                          : "text-muted-foreground hover:text-foreground",
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
                <div className="mt-2 flex items-center justify-between border-t border-[var(--glass-border)] pt-3">
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
          </>
        )}
      </header>

      {/* 内容区域 */}
      <main className="relative z-10 mx-auto max-w-6xl px-3 py-4 pb-safe sm:px-6 sm:py-6">
        <Outlet />
      </main>
    </div>
  );
}

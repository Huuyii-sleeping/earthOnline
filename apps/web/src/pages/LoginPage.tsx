import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { Bot, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginSchema, type LoginInput, login } from "@/features/auth/authApi";
import { useAuthStore } from "@/features/auth/authStore";

export default function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      account: "",
      password: "",
    },
  });

  const onSubmit = async (data: LoginInput) => {
    setError(null);
    setLoading(true);
    try {
      const tokens = await login(data);
      // 登录成功后使用 account 作为临时 userId 和 nickname
      setAuth(data.account, data.account, tokens.access_token, tokens.refresh_token);
      navigate("/app", { replace: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "登录失败，请稍后重试";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        {/* 品牌标识 */}
        <div className="mb-8 flex flex-col items-center">
          <Bot className="h-10 w-10 text-primary" />
          <h1 className="mt-3 text-2xl font-bold">经历成就官</h1>
          <p className="mt-1 text-sm text-muted-foreground">登录你的账号</p>
        </div>

        {/* 登录卡片 */}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="account">账号</Label>
              <Input id="account" placeholder="请输入账号" {...register("account")} />
              {errors.account && (
                <p className="text-sm text-destructive">{errors.account.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                placeholder="请输入密码"
                {...register("password")}
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              登录
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          没有账号？{" "}
          <Link to="/register" className="font-medium text-primary hover:underline">
            去注册
          </Link>
        </p>
      </div>
    </div>
  );
}

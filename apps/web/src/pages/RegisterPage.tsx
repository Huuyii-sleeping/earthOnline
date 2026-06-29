import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { Bot, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  registerSchema,
  type RegisterInput,
  register as registerUser,
} from "@/features/auth/authApi";
import { useAuthStore } from "@/features/auth/authStore";

export default function RegisterPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      account: "",
      password: "",
      nickname: "",
    },
  });

  const onSubmit = async (data: RegisterInput) => {
    setError(null);
    setLoading(true);
    try {
      const tokens = await registerUser(data);
      // 注册成功后自动登录
      setAuth(data.account, data.nickname, tokens.access_token, tokens.refresh_token);
      navigate("/app", { replace: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "注册失败，请稍后重试";
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
          <p className="mt-1 text-sm text-muted-foreground">创建你的账号</p>
        </div>

        {/* 注册卡片 */}
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
              <Label htmlFor="nickname">昵称</Label>
              <Input id="nickname" placeholder="请输入昵称" {...register("nickname")} />
              {errors.nickname && (
                <p className="text-sm text-destructive">{errors.nickname.message}</p>
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
              注册
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          已有账号？{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            去登录
          </Link>
        </p>
      </div>
    </div>
  );
}

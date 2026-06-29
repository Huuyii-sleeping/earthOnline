import { apiClient } from "@/lib/api/client";
import { z } from "zod";
import type { AuthTokens, User } from "@earth-online/shared";

export const loginSchema = z.object({
  account: z.string().min(3, "账号至少3个字符"),
  password: z.string().min(6, "密码至少6个字符"),
});

export const registerSchema = z.object({
  account: z.string().min(3, "账号至少3个字符").max(50),
  password: z.string().min(6, "密码至少6个字符").max(100),
  nickname: z.string().min(1, "昵称不能为空").max(50),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;

export async function login(input: LoginInput): Promise<AuthTokens> {
  const res = await apiClient.post<{ data: AuthTokens }>("/auth/login", input);
  return res.data.data;
}

export async function register(input: RegisterInput): Promise<AuthTokens> {
  const res = await apiClient.post<{ data: AuthTokens }>("/auth/register", input);
  return res.data.data;
}

export async function getMe(): Promise<User> {
  const res = await apiClient.get<{ data: User }>("/me");
  return res.data.data;
}
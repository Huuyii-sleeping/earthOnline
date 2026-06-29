import { apiClient } from "@/lib/api/client";
import type {
  MedalWithVersion,
  UpdateProfileRequest,
  UserProfileResponse,
  VisibilityUpdateRequest,
} from "@earth-online/shared";

// --- Profile API ---

/** GET /users/:id/profile — 任意用户的公开 profile（含奖章数量） */
export async function getUserProfile(userId: string): Promise<UserProfileResponse> {
  const res = await apiClient.get<{ data: UserProfileResponse }>(
    `/users/${userId}/profile`,
  );
  return res.data.data;
}

/** GET /me/profile — 当前登录用户的完整 profile */
export async function getMyProfile(): Promise<UserProfileResponse> {
  const res = await apiClient.get<{ data: UserProfileResponse }>(`/me/profile`);
  return res.data.data;
}

/** PUT /me/profile — 更新 nickname / avatar_url / bio */
export async function updateMyProfile(
  data: UpdateProfileRequest,
): Promise<UserProfileResponse> {
  const res = await apiClient.put<{ data: UserProfileResponse }>(
    `/me/profile`,
    data,
  );
  return res.data.data;
}

/** GET /users/:id/medals — 用户的公开奖章列表（非 owner 仅返回 public） */
export async function getUserMedals(userId: string): Promise<MedalWithVersion[]> {
  const res = await apiClient.get<{ data: MedalWithVersion[] }>(
    `/users/${userId}/medals`,
  );
  return res.data.data;
}

/** GET /me/medals — 当前用户全部奖章（含私密） */
export async function getMyMedals(): Promise<MedalWithVersion[]> {
  const res = await apiClient.get<{ data: MedalWithVersion[] }>(`/me/medals`);
  return res.data.data;
}

/** PUT /medals/:id/visibility — 更新奖章可见性与隐藏字段 */
export async function updateMedalVisibility(
  medalId: string,
  data: VisibilityUpdateRequest,
): Promise<void> {
  await apiClient.put(`/medals/${medalId}/visibility`, data);
}

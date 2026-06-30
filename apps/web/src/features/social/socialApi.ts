import { apiClient } from "@/lib/api/client";
import type {
  FollowStatusResponse,
  FriendListItem,
  FriendRequestResponse,
  InteractionCountResponse,
  InteractionType,
  UserSummary,
} from "@earth-online/shared";

// --- Interactions (轻互动) ---

/** POST /medals/:id/interactions — 添加轻互动（幂等），返回最新计数 */
export async function createInteraction(
  medalId: string,
  type: InteractionType,
): Promise<InteractionCountResponse> {
  const res = await apiClient.post<{ data: InteractionCountResponse }>(
    `/medals/${medalId}/interactions`,
    { type },
  );
  return res.data.data;
}

/** DELETE /medals/:id/interactions/:type — 移除轻互动，返回最新计数 */
export async function deleteInteraction(
  medalId: string,
  type: InteractionType,
): Promise<InteractionCountResponse> {
  const res = await apiClient.delete<{ data: InteractionCountResponse }>(
    `/medals/${medalId}/interactions/${type}`,
  );
  return res.data.data;
}

// --- Follows (关注) ---

/** POST /users/:id/follow — 关注用户（幂等） */
export async function followUser(userId: string): Promise<FollowStatusResponse> {
  const res = await apiClient.post<{ data: FollowStatusResponse }>(`/users/${userId}/follow`);
  return res.data.data;
}

/** DELETE /users/:id/follow — 取消关注（幂等） */
export async function unfollowUser(userId: string): Promise<FollowStatusResponse> {
  const res = await apiClient.delete<{ data: FollowStatusResponse }>(`/users/${userId}/follow`);
  return res.data.data;
}

/** GET /me/following — 我关注的人 */
export async function listFollowing(): Promise<UserSummary[]> {
  const res = await apiClient.get<{ data: UserSummary[] }>(`/me/following`);
  return res.data.data;
}

/** GET /me/followers — 关注我的人 */
export async function listFollowers(): Promise<UserSummary[]> {
  const res = await apiClient.get<{ data: UserSummary[] }>(`/me/followers`);
  return res.data.data;
}

// --- Friends (好友) ---

/** POST /friends/:id/request — 发送好友申请 */
export async function requestFriend(userId: string): Promise<FriendRequestResponse> {
  const res = await apiClient.post<{ data: FriendRequestResponse }>(`/friends/${userId}/request`);
  return res.data.data;
}

/** POST /friends/:id/accept — 接受好友申请（:id 为 friendship id） */
export async function acceptFriend(friendshipId: string): Promise<FriendRequestResponse> {
  const res = await apiClient.post<{ data: FriendRequestResponse }>(
    `/friends/${friendshipId}/accept`,
  );
  return res.data.data;
}

/** POST /friends/:id/reject — 拒绝好友申请（:id 为 friendship id） */
export async function rejectFriend(friendshipId: string): Promise<FriendRequestResponse> {
  const res = await apiClient.post<{ data: FriendRequestResponse }>(
    `/friends/${friendshipId}/reject`,
  );
  return res.data.data;
}

/** GET /me/friends — 我的好友列表 */
export async function listFriends(): Promise<FriendListItem[]> {
  const res = await apiClient.get<{ data: FriendListItem[] }>(`/me/friends`);
  return res.data.data;
}

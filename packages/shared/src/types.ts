// 用户
export interface User {
  id: string;
  nickname: string;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
  updated_at: string;
}

// 认证
export interface AuthTokens {
  access_token: string;
  refresh_token: string;
}

export interface LoginRequest {
  account: string;
  password: string;
}

export interface RegisterRequest {
  account: string;
  password: string;
  nickname: string;
}

// Agent 配置
export interface AgentProfile {
  id: string;
  user_id: string;
  name: string;
  personality: string | null;
  identity_prompt: string | null;
  dialogue_style: string | null;
  avatar_url: string | null;
  proactive_level: number;
  created_at: string;
  updated_at: string;
}

// 经历
export type ExperienceStatus =
  | "collecting"
  | "summarized"
  | "medal_generating"
  | "completed"
  | "archived";

export interface Experience {
  id: string;
  user_id: string;
  title: string | null;
  status: ExperienceStatus;
  occurred_at: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

// 对话
export type MessageRole = "user" | "agent" | "system";
export type ContentType = "text" | "image" | "audio" | "generated_summary";

export interface ConversationMessage {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  content_type: ContentType;
  asset_id: string | null;
  created_at: string;
}

export interface ConversationSession {
  id: string;
  user_id: string;
  experience_id: string;
  agent_profile_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

// 奖章
export type MemoryWeight = "light" | "medium" | "heavy";
export type Visibility = "public" | "friends" | "private";

export interface Medal {
  id: string;
  user_id: string;
  experience_id: string;
  current_version_id: string | null;
  title: string;
  short_reason: string;
  memory_weight: MemoryWeight;
  image_url: string | null;
  visibility: Visibility;
  edited_by_user: boolean;
  created_at: string;
  updated_at: string;
}

export type MedalVersionType =
  | "initial"
  | "meaning_regeneration"
  | "visual_regeneration"
  | "user_edit";

export interface MedalVersion {
  id: string;
  medal_id: string;
  version_type: MedalVersionType;
  title: string;
  short_reason: string;
  meaning_focus: string | null;
  story: string | null;
  analysis_json: Record<string, unknown> | null;
  visual_prompt: string | null;
  image_url: string | null;
  created_by: "agent" | "user";
  created_at: string;
}

// 素材
export type AssetType = "image" | "audio" | "video" | "document";

export interface Asset {
  id: string;
  user_id: string;
  experience_id: string | null;
  storage_key: string;
  url: string;
  mime_type: string;
  asset_type: AssetType;
  size_bytes: number;
  metadata: Record<string, unknown> | null;
  visibility: Visibility;
  created_at: string;
}

// 社交
export type InteractionType = "applaud" | "relate" | "brave" | "memorable" | "favorite";

export interface MedalInteraction {
  id: string;
  medal_id: string;
  user_id: string;
  type: InteractionType;
  created_at: string;
}

// 关注
export interface FollowRelation {
  id: string;
  follower_id: string;
  following_id: string;
  created_at: string;
}

// 好友
export type FriendshipStatus = "pending" | "accepted" | "rejected" | "blocked";

export interface FriendRelation {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
  created_at: string;
  updated_at: string;
}

// 通知
export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
}

// 生成任务
export type JobType =
  | "speech_to_text"
  | "image_understanding"
  | "experience_summary"
  | "medal_generation"
  | "visual_generation"
  | "meaning_regeneration"
  | "visual_regeneration"
  | "stage_summary";
export type JobStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export interface GenerationJob {
  id: string;
  user_id: string;
  experience_id: string | null;
  medal_id: string | null;
  job_type: JobType;
  status: JobStatus;
  input_json: Record<string, unknown> | null;
  output_json: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// API 响应
export interface ApiResponse<T> {
  data: T;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
}

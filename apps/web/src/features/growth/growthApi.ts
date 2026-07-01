import { apiClient } from "@/lib/api/client";
import { useAgentRuntimeConfigStore } from "@/features/agent/runtimeConfig";

// --- Growth profile (成长画像 M8) ---

export interface GrowthExperienceType {
  type: string;
  weight: number;
}

export interface GrowthEmotionTrend {
  label: string;
  summary: string;
}

export interface GrowthProfile {
  id?: string;
  user_id: string;
  trait_keywords: string[];
  growth_keywords: string[];
  experience_types: GrowthExperienceType[];
  emotion_trends: GrowthEmotionTrend[];
  summary_text: string | null;
  source_counts: Record<string, number>;
  last_refreshed_at: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface GrowthInsight {
  id: string;
  user_id: string;
  period_type: string;
  period_start: string | null;
  period_end: string | null;
  title: string;
  summary_text: string;
  keywords: string[];
  signals: Record<string, unknown>;
  generated_by: string;
  trigger: string;
  created_at: string;
}

export interface PaginatedGrowthInsights {
  data: GrowthInsight[];
  total: number;
  page: number;
  page_size: number;
}

/** GET /growth-profile — 当前用户成长画像，不存在时返回空画像结构 */
export async function getGrowthProfile(): Promise<GrowthProfile> {
  const res = await apiClient.get<{ data: GrowthProfile }>(`/growth-profile`);
  return res.data.data;
}

/** POST /growth-profile/refresh — 手动刷新当前用户画像 */
export async function refreshGrowthProfile(
  scope: "all" | "recent" = "all",
): Promise<GrowthProfile> {
  const agentConfig = useAgentRuntimeConfigStore.getState();
  const agentRuntime = agentConfig.isConfigured
    ? {
        api_url: agentConfig.apiUrl,
        api_key: agentConfig.apiKey,
        model: agentConfig.model,
        system_prompt: agentConfig.systemPrompt,
      }
    : undefined;

  const res = await apiClient.post<{ data: GrowthProfile }>(
    `/growth-profile/refresh`,
    {
      scope,
      agent_runtime: agentRuntime,
    },
    { timeout: 120000 },
  );
  return res.data.data;
}

/** GET /growth-insights — 分页返回当前用户洞察记录 */
export async function listGrowthInsights(
  page = 1,
  pageSize = 10,
): Promise<PaginatedGrowthInsights> {
  const res = await apiClient.get<PaginatedGrowthInsights>(`/growth-insights`, {
    params: { page, page_size: pageSize },
  });
  return res.data;
}

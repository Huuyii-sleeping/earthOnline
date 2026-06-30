import { apiClient } from "@/lib/api/client";

export type PeriodType = "week" | "month";

export interface StageSummary {
  id: string;
  user_id: string;
  period_type: PeriodType;
  period_start: string;
  period_end: string;
  status: string;
  title: string;
  summary_text: string;
  story?: string | null;
  memory_weight: "light" | "medium" | "heavy";
  highlights?: string[] | null;
  experience_count: number;
  generated_by: string;
  trigger: "manual" | "scheduled" | string;
  created_at: string;
}

export interface AgentProfile {
  id: string;
  user_id: string;
  name: string;
  personality?: string | null;
  identity_prompt?: string | null;
  dialogue_style?: string | null;
  avatar_url?: string | null;
  proactive_level: number;
  created_at: string;
  updated_at: string;
}

export interface UpdateAgentProfileRequest {
  name?: string;
  personality?: string;
  identity_prompt?: string;
  dialogue_style?: string;
  avatar_url?: string;
  proactive_level?: number;
}

export async function getAgentProfile(): Promise<AgentProfile> {
  const res = await apiClient.get<{ data: AgentProfile }>("/agent-profile");
  return res.data.data;
}

export async function updateAgentProfile(data: UpdateAgentProfileRequest): Promise<AgentProfile> {
  const res = await apiClient.put<{ data: AgentProfile }>("/agent-profile", data);
  return res.data.data;
}

export async function listStageSummaries(periodType?: PeriodType): Promise<StageSummary[]> {
  const res = await apiClient.get<{ data: StageSummary[] }>("/stage-summaries", {
    params: { period_type: periodType, page: 1, page_size: 20 },
  });
  return res.data.data;
}

export async function generateStageSummary(periodType: PeriodType): Promise<StageSummary> {
  const res = await apiClient.post<{ data: StageSummary }>("/stage-summaries/generate", {
    period_type: periodType,
  });
  return res.data.data;
}

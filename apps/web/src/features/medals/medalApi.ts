import { apiClient } from "@/lib/api/client";
import { useAgentRuntimeConfigStore } from "@/features/agent/runtimeConfig";
import type { Medal, MedalVersion } from "@earth-online/shared";

// --- Medal API ---

export interface GenerateMedalRequest {
  session_id: string;
  agent_runtime?: {
    api_url: string;
    api_key: string;
    model: string;
    system_prompt?: string;
  };
}

export async function generateMedal(experienceId: string, sessionId: string): Promise<Medal> {
  const agentConfig = useAgentRuntimeConfigStore.getState();
  const agentRuntime = agentConfig.isConfigured
    ? {
        api_url: agentConfig.apiUrl,
        api_key: agentConfig.apiKey,
        model: agentConfig.model,
        system_prompt: agentConfig.systemPrompt,
      }
    : undefined;

  const res = await apiClient.post<{ data: Medal }>(
    `/experiences/${experienceId}/medals/generate`,
    { session_id: sessionId, agent_runtime: agentRuntime } as GenerateMedalRequest,
  );
  return res.data.data;
}

export async function getMedal(id: string): Promise<Medal> {
  const res = await apiClient.get<{ data: Medal }>(`/medals/${id}`);
  return res.data.data;
}

export async function listMedals(): Promise<Medal[]> {
  const res = await apiClient.get<{ data: Medal[] }>("/medals");
  return res.data.data;
}

export interface UpdateMedalRequest {
  title?: string;
  short_reason?: string;
  memory_weight?: "light" | "medium" | "heavy";
  image_url?: string;
  visibility?: "public" | "friends" | "private";
}

export async function updateMedal(id: string, updates: UpdateMedalRequest): Promise<Medal> {
  const res = await apiClient.put<{ data: Medal }>(`/medals/${id}`, updates);
  return res.data.data;
}

export async function regenerateMeaning(
  id: string,
  direction?: string,
  userInput?: string,
): Promise<Medal> {
  const agentConfig = useAgentRuntimeConfigStore.getState();
  const agentRuntime = agentConfig.isConfigured
    ? {
        api_url: agentConfig.apiUrl,
        api_key: agentConfig.apiKey,
        model: agentConfig.model,
        system_prompt: agentConfig.systemPrompt,
      }
    : undefined;

  const res = await apiClient.post<{ data: Medal }>(`/medals/${id}/regenerate/meaning`, {
    direction,
    user_input: userInput,
    agent_runtime: agentRuntime,
  });
  return res.data.data;
}

// --- Medal Versions ---

export async function listMedalVersions(id: string): Promise<MedalVersion[]> {
  const res = await apiClient.get<{ data: MedalVersion[] }>(`/medals/${id}/versions`);
  return res.data.data;
}

export async function restoreVersion(medalId: string, versionId: string): Promise<Medal> {
  const res = await apiClient.post<{ data: Medal }>(
    `/medals/${medalId}/versions/${versionId}/restore`,
  );
  return res.data.data;
}

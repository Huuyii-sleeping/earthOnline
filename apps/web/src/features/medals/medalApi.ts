import { apiClient } from "@/lib/api/client";
import type { Medal, MedalVersion } from "@earth-online/shared";

// --- Medal API ---

export interface GenerateMedalRequest {
  session_id: string;
}

export async function generateMedal(
  experienceId: string,
  sessionId: string,
): Promise<Medal> {
  const res = await apiClient.post<{ data: Medal }>(
    `/experiences/${experienceId}/medals/generate`,
    { session_id: sessionId } as GenerateMedalRequest,
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

export async function updateMedal(
  id: string,
  updates: UpdateMedalRequest,
): Promise<Medal> {
  const res = await apiClient.put<{ data: Medal }>(`/medals/${id}`, updates);
  return res.data.data;
}

export async function regenerateMeaning(
  id: string,
  direction?: string,
  userInput?: string,
): Promise<Medal> {
  const res = await apiClient.post<{ data: Medal }>(
    `/medals/${id}/regenerate/meaning`,
    { direction, user_input: userInput },
  );
  return res.data.data;
}

// --- Medal Versions ---

export async function listMedalVersions(id: string): Promise<MedalVersion[]> {
  const res = await apiClient.get<{ data: MedalVersion[] }>(`/medals/${id}/versions`);
  return res.data.data;
}

export async function restoreVersion(
  medalId: string,
  versionId: string,
): Promise<Medal> {
  const res = await apiClient.post<{ data: Medal }>(
    `/medals/${medalId}/versions/${versionId}/restore`,
  );
  return res.data.data;
}
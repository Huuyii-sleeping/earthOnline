import { apiClient } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/token";
import type { Experience, ConversationSession, ConversationMessage } from "@earth-online/shared";

// --- Experience ---

export async function createExperience(title?: string): Promise<Experience> {
  const res = await apiClient.post<{ data: Experience }>("/experiences", {
    title: title || undefined,
  });
  return res.data.data;
}

export async function getExperience(id: string): Promise<Experience> {
  const res = await apiClient.get<{ data: Experience }>(`/experiences/${id}`);
  return res.data.data;
}

export async function listExperiences(): Promise<Experience[]> {
  const res = await apiClient.get<{ data: Experience[] }>("/experiences");
  return res.data.data;
}

// --- Conversation Session ---

export async function createSession(experienceId: string): Promise<ConversationSession> {
  const res = await apiClient.post<{ data: ConversationSession }>(
    `/experiences/${experienceId}/sessions`,
  );
  return res.data.data;
}

export async function listMessages(sessionId: string): Promise<ConversationMessage[]> {
  const res = await apiClient.get<{ data: ConversationMessage[] }>(
    `/sessions/${sessionId}/messages`,
  );
  return res.data.data;
}

interface SendMessageResult {
  user_message: ConversationMessage;
  agent_message: ConversationMessage | null;
  error?: string;
}

export async function sendMessage(
  sessionId: string,
  content: string,
  contentType?: string,
): Promise<SendMessageResult> {
  const res = await apiClient.post<{ data: SendMessageResult }>(
    `/sessions/${sessionId}/messages`,
    {
      content,
      content_type: contentType,
    },
  );
  return res.data.data;
}

// --- Summary ---

export interface ConversationSummary {
  experienceSummary: string;
  keyMoments: string[];
  detectedEmotions: string[];
  possibleMeaning: string;
  readyToGenerate: boolean;
}

export async function generateSummary(sessionId: string): Promise<ConversationSummary> {
  const res = await apiClient.post<{ data: ConversationSummary }>(
    `/sessions/${sessionId}/summary`,
  );
  return res.data.data;
}

// --- SSE Stream ---

export function streamSession(
  sessionId: string,
  onToken: (token: string) => void,
  onDone?: () => void,
  onError?: (error: Error) => void,
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const token = getAccessToken();
      const response = await fetch(`/api/v1/agent/sessions/${sessionId}/stream`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "text/event-stream",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Stream failed: ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No stream body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            continue;
          }
          if (line.startsWith("data: ")) {
            const payload = line.slice(6).trim();
            if (!payload) continue;

            try {
              const data = JSON.parse(payload);
              if (data.content) {
                onToken(data.content);
              }
              if (data.ok !== undefined) {
                onDone?.();
              }
            } catch {
              // Ignore parse errors for partial data
            }
          }
        }

        if (done) {
          onDone?.();
          break;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        onError?.(err);
      }
    }
  })();

  return controller;
}
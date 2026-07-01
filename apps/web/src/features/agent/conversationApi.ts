import { getAccessToken } from "@/lib/auth/token";
import { useAgentRuntimeConfigStore } from "./runtimeConfig";
import { apiClient } from "@/lib/api/client";
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

// --- Summary ---

export interface ConversationSummary {
  experienceSummary: string;
  keyMoments: string[];
  detectedEmotions: string[];
  possibleMeaning: string;
  readyToGenerate: boolean;
}

export async function generateSummary(sessionId: string): Promise<ConversationSummary> {
  const agentConfig = useAgentRuntimeConfigStore.getState();
  const agentRuntime = agentConfig.isConfigured
    ? {
        api_url: agentConfig.apiUrl,
        api_key: agentConfig.apiKey,
        model: agentConfig.model,
        system_prompt: agentConfig.systemPrompt,
      }
    : undefined;

  const res = await apiClient.post<{ data: ConversationSummary }>(
    `/sessions/${sessionId}/summary`,
    { agent_runtime: agentRuntime },
    { timeout: 120000 },
  );
  return res.data.data;
}

// --- SSE Stream ---

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone?: (data: { userMessageId: string; agentMessageId: string }) => void;
  onError?: (error: Error) => void;
  /** Called when the agent is executing tool calls (show "thinking" indicator). */
  onThinking?: () => void;
}

/**
 * Send a message and stream the agent's reply token by token via SSE.
 * Returns an AbortController so the caller can cancel the stream.
 */
export function sendMessageStream(
  sessionId: string,
  content: string,
  callbacks: StreamCallbacks,
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const token = getAccessToken();
      const agentConfig = useAgentRuntimeConfigStore.getState();
      const agentRuntime = agentConfig.isConfigured
        ? {
            api_url: agentConfig.apiUrl,
            api_key: agentConfig.apiKey,
            model: agentConfig.model,
            system_prompt: agentConfig.systemPrompt,
          }
        : undefined;

      const response = await fetch(`/api/v1/sessions/${sessionId}/messages/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          content,
          agent_runtime: agentRuntime,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`Stream failed: ${response.status} ${errText}`);
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
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;

          try {
            const data = JSON.parse(payload);
            if (data.error) {
              callbacks.onError?.(new Error(data.error));
              return;
            }
            if (data.thinking) {
              callbacks.onThinking?.();
            }
            if (data.token) {
              callbacks.onToken(data.token);
            }
            if (data.done) {
              callbacks.onDone?.({
                userMessageId: data.user_message_id || "",
                agentMessageId: data.agent_message_id || "",
              });
              return;
            }
          } catch {
            // Ignore partial JSON
          }
        }

        if (done) break;
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        callbacks.onError?.(err);
      }
    }
  })();

  return controller;
}

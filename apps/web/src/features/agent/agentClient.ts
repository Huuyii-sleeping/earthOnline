import type { AgentRuntimeConfig } from "./runtimeConfig";

export interface AgentChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAICompatibleResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface OpenAICompatibleStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
    };
    message?: {
      content?: string;
    };
    text?: string;
  }>;
}

function resolveChatCompletionsUrl(apiUrl: string) {
  const trimmedUrl = apiUrl.trim().replace(/\/+$/, "");

  if (trimmedUrl.endsWith("/chat/completions")) {
    return trimmedUrl;
  }

  return `${trimmedUrl}/chat/completions`;
}

export async function sendAgentMessage(
  config: AgentRuntimeConfig,
  messages: AgentChatMessage[],
): Promise<string> {
  const response = await fetch(resolveChatCompletionsUrl(config.apiUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.7,
      messages: [{ role: "system", content: config.systemPrompt }, ...messages],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Agent API 请求失败：${response.status} ${body.slice(0, 160)}`);
  }

  const data = (await response.json()) as OpenAICompatibleResponse;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Agent API 没有返回可展示的回复内容");
  }

  return content;
}

function readStreamToken(payload: string) {
  const data = JSON.parse(payload) as OpenAICompatibleStreamChunk;
  const choice = data.choices?.[0];

  return choice?.delta?.content ?? choice?.message?.content ?? choice?.text ?? "";
}

function readBufferedSseEvents(buffer: string) {
  const events: string[] = [];
  let rest = buffer;
  let separatorIndex = rest.indexOf("\n\n");

  while (separatorIndex !== -1) {
    events.push(rest.slice(0, separatorIndex));
    rest = rest.slice(separatorIndex + 2);
    separatorIndex = rest.indexOf("\n\n");
  }

  return { events, rest };
}

export async function streamAgentMessage(
  config: AgentRuntimeConfig,
  messages: AgentChatMessage[],
  onToken: (token: string) => void,
): Promise<string> {
  const response = await fetch(resolveChatCompletionsUrl(config.apiUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.7,
      stream: true,
      messages: [{ role: "system", content: config.systemPrompt }, ...messages],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Agent API 请求失败：${response.status} ${body.slice(0, 160)}`);
  }

  if (!response.body) {
    throw new Error("当前浏览器没有拿到 Agent API 的流式响应体");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    buffer = buffer.replace(/\r\n/g, "\n");

    const parsed = readBufferedSseEvents(buffer);
    buffer = parsed.rest;

    for (const event of parsed.events) {
      const payloads = event
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());

      for (const payload of payloads) {
        if (!payload || payload === "[DONE]") continue;

        const token = readStreamToken(payload);
        if (!token) continue;

        result += token;
        onToken(token);
      }
    }

    if (done) break;
  }

  if (buffer.trim()) {
    const payload = buffer
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("data:"))
      ?.slice(5)
      .trim();

    if (payload && payload !== "[DONE]") {
      const token = readStreamToken(payload);
      result += token;
      onToken(token);
    }
  }

  if (!result) {
    throw new Error("Agent API 没有返回可展示的流式内容");
  }

  return result;
}

export function createMockAgentReply(userMessage: string, turnCount: number) {
  if (turnCount <= 2) {
    return `我先帮你抓一下重点：你刚才说的是“${userMessage}”。这件事里最值得被看见的部分，是你做了什么、当时是什么感受，还是它对你有什么意义？`;
  }

  return "我已经大概理解这段经历了。接下来可以继续补充细节，或者告诉我你最想保留的那个瞬间，我会帮你把它提炼成一枚经历奖章。";
}

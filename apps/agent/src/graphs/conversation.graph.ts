import {
  conversationFollowupPromptV1,
  experienceSummaryPromptV1,
} from "../prompts/conversation-followup.v1.js";
import { getLLMProviderFromRuntime, type AgentRuntimeConfig } from "../providers/index.js";
import { checkSafety } from "../safety/index.js";
import type { ChatMessage } from "../providers/types.js";
import type { ToolContext } from "../providers/types.js";
import { runReActLoop, streamConversationWithTools } from "../agent/react-loop.js";
import type { ToolRegistry } from "../tools/registry.js";

export interface ConversationResult {
  reply: string;
  done: boolean;
}

/**
 * Process a user message through the ReAct conversation loop.
 *
 * If tools are available, the Agent can call them to enrich its understanding
 * of the user's context (existing medals, growth profile, etc.) before
 * generating a reply. If no tools are provided, falls back to plain chat.
 *
 * @param tools - Tool registry (null if tools unavailable)
 * @param context - Tool execution context (userId, sessionId)
 */
export async function processConversation(
  history: { role: "user" | "assistant"; content: string }[],
  userMessage: string,
  runtime?: AgentRuntimeConfig | null,
  tools?: ToolRegistry | null,
  context?: ToolContext,
  summary?: string,
): Promise<ConversationResult> {
  const systemPrompt = runtime?.system_prompt || conversationFollowupPromptV1.template;
  const provider = getLLMProviderFromRuntime(runtime);

  // If tools are available, use the ReAct loop for multi-step reasoning.
  if (tools && tools.getDefinitions().length > 0) {
    const result = await runReActLoop(
      provider,
      tools,
      systemPrompt,
      history,
      userMessage,
      context,
      summary,
    );
    return {
      reply: result.reply,
      done: result.done,
    };
  }

  // Fallback: plain chat without tools (original behavior).
  const safetyResult = checkSafety(userMessage);
  if (!safetyResult.safe) {
    return {
      reply: safetyResult.safeResponse!,
      done: false,
    };
  }

  const messages: ChatMessage[] = buildChatMessages(systemPrompt, history, userMessage, summary);
  const response = await provider.chat(messages);

  const skipKeywords = ["生成奖章", "直接生成", "可以了", "总结", "generate medal"];
  const wantsToGenerate = skipKeywords.some((kw) =>
    userMessage.toLowerCase().includes(kw.toLowerCase()),
  );

  const summaryKeywords = ["总结", "准备好了", "可以生成", "ready to generate", "summary"];
  const isReady =
    wantsToGenerate ||
    summaryKeywords.some((kw) => response.content.toLowerCase().includes(kw.toLowerCase()));

  return {
    reply: response.content,
    done: isReady,
  };
}

/**
 * Stream a conversation response token by token.
 *
 * Uses a hybrid approach: if tools are available and the message warrants
 * context enrichment, runs the ReAct loop first (non-streaming), then
 * yields the final reply. Otherwise, streams directly for low latency.
 *
 * @param tools - Tool registry (null if tools unavailable)
 * @param context - Tool execution context (userId, sessionId)
 */
export async function* streamConversation(
  history: { role: "user" | "assistant"; content: string }[],
  userMessage: string,
  runtime?: AgentRuntimeConfig | null,
  tools?: ToolRegistry | null,
  context?: ToolContext,
  summary?: string,
): AsyncGenerator<string, void, unknown> {
  const systemPrompt = runtime?.system_prompt || conversationFollowupPromptV1.template;
  const provider = getLLMProviderFromRuntime(runtime);

  if (tools && tools.getDefinitions().length > 0) {
    yield* streamConversationWithTools(
      provider,
      tools,
      systemPrompt,
      history,
      userMessage,
      context,
      summary,
    );
    return;
  }

  // Fallback: plain streaming without tools.
  const safetyResult = checkSafety(userMessage);
  if (!safetyResult.safe) {
    yield safetyResult.safeResponse!;
    return;
  }

  const messages: ChatMessage[] = buildChatMessages(systemPrompt, history, userMessage, summary);
  yield* provider.stream(messages);
}

/**
 * Build the chat message array from system prompt, history, and current user message.
 * If a summary exists, it's inserted as a system message after the main prompt.
 */
function buildChatMessages(
  systemPrompt: string,
  history: { role: "user" | "assistant"; content: string }[],
  userMessage: string,
  summary?: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

  if (summary) {
    messages.push({
      role: "system",
      content: `之前的对话摘要：\n${summary}`,
    });
  }

  messages.push(
    ...history.map((h) => ({
      role: h.role === "user" ? ("user" as const) : ("assistant" as const),
      content: h.content,
    })),
  );
  messages.push({ role: "user", content: userMessage });

  return messages;
}

/**
 * Generate a pre-generation summary of the conversation.
 */
export async function generateConversationSummary(
  history: { role: "user" | "assistant"; content: string }[],
  runtime?: AgentRuntimeConfig | null,
): Promise<{
  experienceSummary: string;
  keyMoments: string[];
  detectedEmotions: string[];
  possibleMeaning: string;
  readyToGenerate: boolean;
}> {
  const systemPrompt = experienceSummaryPromptV1.template;
  const conversationText = history
    .map((h) => `${h.role === "user" ? "用户" : "Agent"}：${h.content}`)
    .join("\n\n");

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `以下是对话内容，请生成总结：\n\n${conversationText}` },
  ];

  const provider = getLLMProviderFromRuntime(runtime);
  const response = await provider.chat(messages);

  try {
    let content = response.content.trim();
    if (content.startsWith("```")) {
      content = content.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    return JSON.parse(content);
  } catch {
    return {
      experienceSummary: "无法自动生成总结，请用户确认。",
      keyMoments: [],
      detectedEmotions: [],
      possibleMeaning: "",
      readyToGenerate: false,
    };
  }
}

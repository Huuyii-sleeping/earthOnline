import { conversationFollowupPromptV1, experienceSummaryPromptV1 } from "../prompts/conversation-followup.v1.js";
import { getLLMProvider } from "../providers/index.js";
import { checkSafety } from "../safety/index.js";
import type { ChatMessage } from "../providers/types.js";

export interface ConversationState {
  messages: ChatMessage[];
  userMessage: string;
  history: { role: "user" | "assistant"; content: string }[];
  shouldSummarize: boolean;
}

export interface ConversationResult {
  reply: string;
  done: boolean;
}

/**
 * Process a user message through the conversation graph.
 * 1. Safety check
 * 2. Build context from history
 * 3. Call LLM for response
 * 4. Detect if user wants to generate summary/medal
 */
export async function processConversation(
  history: { role: "user" | "assistant"; content: string }[],
  userMessage: string,
): Promise<ConversationResult> {
  // 1. Safety check
  const safetyResult = checkSafety(userMessage);
  if (!safetyResult.safe) {
    return {
      reply: safetyResult.safeResponse!,
      done: false,
    };
  }

  // 2. Detect if user wants to skip to generation
  const skipKeywords = ["生成奖章", "直接生成", "可以了", "总结", "generate medal"];
  const wantsToGenerate = skipKeywords.some((kw) =>
    userMessage.toLowerCase().includes(kw.toLowerCase()),
  );

  // 3. Build messages for LLM
  const systemPrompt = conversationFollowupPromptV1.template;
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({
      role: h.role === "user" ? "user" as const : "assistant" as const,
      content: h.content,
    })),
    { role: "user", content: userMessage },
  ];

  // 4. Call LLM
  const provider = getLLMProvider();
  const response = await provider.chat(messages);

  // 5. Check if agent thinks it's ready to summarize
  const summaryKeywords = ["总结", "准备好了", "可以生成", "ready to generate", "summary"];
  const isReady = wantsToGenerate || summaryKeywords.some((kw) =>
    response.content.toLowerCase().includes(kw.toLowerCase()),
  );

  return {
    reply: response.content,
    done: isReady,
  };
}

/**
 * Generate a pre-generation summary of the conversation.
 */
export async function generateConversationSummary(
  history: { role: "user" | "assistant"; content: string }[],
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

  const provider = getLLMProvider();
  const response = await provider.chat(messages);

  // Parse JSON from response
  try {
    // Strip markdown code fences if present
    let content = response.content.trim();
    if (content.startsWith("```")) {
      content = content.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    return JSON.parse(content);
  } catch {
    // If parsing fails, return a basic summary
    return {
      experienceSummary: "无法自动生成总结，请用户确认。",
      keyMoments: [],
      detectedEmotions: [],
      possibleMeaning: "",
      readyToGenerate: false,
    };
  }
}

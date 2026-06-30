import {
  medalGenerationPromptV1,
  medalRegenerationPromptV1,
} from "../prompts/medal-generation.v1.js";
import {
  getLLMProvider,
  getLLMProviderFromRuntime,
  type AgentRuntimeConfig,
} from "../providers/index.js";
import type { ChatMessage } from "../providers/types.js";
import type { MedalGeneration } from "../schemas/medal.js";

export interface MedalHistoryItem {
  role: string;
  content: string;
}

export function getExperienceMedalGraphMetadata() {
  return {
    promptName: medalGenerationPromptV1.name,
    promptVersion: medalGenerationPromptV1.version,
  };
}

function buildConversationContext(history: MedalHistoryItem[]): string {
  return history
    .filter((msg) => msg.content.trim())
    .map((msg) => {
      const speaker = msg.role === "user" ? "用户" : "Agent";
      return `${speaker}：${msg.content.trim()}`;
    })
    .join("\n\n");
}

function parseMedalResponse(raw: string): MedalGeneration {
  let content = raw.trim();

  // Strip markdown code fences if present
  if (content.startsWith("```")) {
    content = content.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  // Find JSON object boundaries
  const jsonStart = content.indexOf("{");
  const jsonEnd = content.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error("Agent did not return parseable JSON");
  }

  const jsonStr = content.slice(jsonStart, jsonEnd + 1);
  const parsed = JSON.parse(jsonStr) as MedalGeneration;

  // Validate required fields
  if (!parsed.title || !parsed.shortReason || !parsed.meaningFocus || !parsed.story) {
    throw new Error("Agent response missing required fields");
  }

  // Normalize memoryWeight
  const validWeights = ["light", "medium", "heavy"];
  if (!validWeights.includes(parsed.memoryWeight)) {
    parsed.memoryWeight = "medium";
  }

  return parsed;
}

/**
 * Generate a medal from conversation history.
 * This is the core of the medal generation graph.
 */
export async function generateMedal(
  history: MedalHistoryItem[],
  experienceSummary?: string,
  runtime?: AgentRuntimeConfig | null,
): Promise<MedalGeneration> {
  const systemPrompt = medalGenerationPromptV1.template;
  const conversationText = buildConversationContext(history);

  let userContent = `以下是对话记录，请基于这段经历生成一枚奖章：\n\n${conversationText}`;
  if (experienceSummary) {
    userContent += `\n\n经历总结：${experienceSummary}`;
  }

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  const provider = getLLMProviderFromRuntime(runtime);
  const response = await provider.chat(messages);

  return parseMedalResponse(response.content);
}

/**
 * Regenerate the meaning focus of a medal.
 * The user can provide a direction hint or natural language input.
 */
export async function regenerateMedalMeaning(
  history: MedalHistoryItem[],
  direction?: string,
  userInput?: string,
  experienceSummary?: string,
  runtime?: AgentRuntimeConfig | null,
): Promise<MedalGeneration> {
  const systemPrompt = medalRegenerationPromptV1.template;
  const conversationText = buildConversationContext(history);

  let userContent = `以下是对话记录，请重新生成奖章：\n\n${conversationText}`;

  if (experienceSummary) {
    userContent += `\n\n经历总结：${experienceSummary}`;
  }

  if (direction) {
    const directionMap: Record<string, string> = {
      action: "请更侧重行动和主动性",
      emotion: "请更侧重情绪感受和变化",
      growth: "请更侧重个人成长和自我认知",
      relationship: "请更侧重人际关系和连接",
      meaning: "请更侧重这件事的深层意义",
    };
    userContent += `\n\n方向提示：${directionMap[direction] || direction}`;
  }

  if (userInput) {
    userContent += `\n\n用户补充描述：${userInput}`;
  }

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  const provider = getLLMProviderFromRuntime(runtime);
  const response = await provider.chat(messages);

  return parseMedalResponse(response.content);
}

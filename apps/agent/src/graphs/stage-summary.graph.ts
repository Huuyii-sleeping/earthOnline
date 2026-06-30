import { stageSummaryPromptV1 } from "../prompts/stage-summary.v1.js";
import { getLLMProvider } from "../providers/index.js";
import type { ChatMessage } from "../providers/types.js";
import { stageSummarySchema, type StageSummaryGeneration } from "../schemas/stage-summary.js";

export interface StageExperienceItem {
  title?: string;
  summary?: string;
  occurredAt?: string;
}

export function getStageSummaryGraphMetadata() {
  return {
    promptName: stageSummaryPromptV1.name,
    promptVersion: stageSummaryPromptV1.version,
  };
}

function buildExperiencesContext(experiences: StageExperienceItem[]): string {
  return experiences
    .map((exp, i) => {
      const parts: string[] = [];
      if (exp.occurredAt) parts.push(`时间：${exp.occurredAt}`);
      if (exp.title) parts.push(`标题：${exp.title}`);
      if (exp.summary) parts.push(`摘要：${exp.summary}`);
      return `经历 ${i + 1}\n${parts.join("\n")}`;
    })
    .join("\n\n");
}

// parseStageSummary extracts and validates the JSON the LLM returns. Validation
// goes through the Zod schema so malformed output fails loudly rather than
// silently persisting half-built records.
function parseStageSummary(raw: string): StageSummaryGeneration {
  let content = raw.trim();

  if (content.startsWith("```")) {
    content = content.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const jsonStart = content.indexOf("{");
  const jsonEnd = content.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error("Agent did not return parseable JSON");
  }

  const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
  return stageSummarySchema.parse(parsed);
}

/**
 * Generate a stage summary (and stage medal) from a window of experiences.
 * periodLabel is a human hint such as "本周" or "本月" so the model frames the
 * roll-up at the right granularity.
 */
export async function generateStageSummary(
  experiences: StageExperienceItem[],
  periodLabel: string,
): Promise<StageSummaryGeneration> {
  const systemPrompt = stageSummaryPromptV1.template;
  const experiencesText = buildExperiencesContext(experiences);

  const userContent = `以下是用户在${periodLabel}记录的 ${experiences.length} 段经历，请回顾并生成这个阶段的总结与阶段奖章：\n\n${experiencesText}`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  const provider = getLLMProvider();
  const response = await provider.chat(messages);

  return parseStageSummary(response.content);
}

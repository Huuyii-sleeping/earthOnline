import { growthProfilePromptV1 } from "../prompts/growth-profile.v1.js";
import { getLLMProviderFromRuntime, type AgentRuntimeConfig } from "../providers/index.js";
import type { ChatMessage } from "../providers/types.js";
import { growthProfileSchema, type GrowthProfileGeneration } from "../schemas/growth-profile.js";

// GrowthMedalItem mirrors the Go API's GrowthMedalItem payload.
export interface GrowthMedalItem {
  id?: string;
  title?: string;
  shortReason?: string;
  meaningFocus?: string;
  story?: string;
  memoryWeight?: string;
  createdAt?: string;
  experienceId?: string;
  experience?: string;
  experienceAt?: string;
}

// GrowthStageSummaryItem mirrors the Go API's GrowthStageSummaryItem payload.
export interface GrowthStageSummaryItem {
  id?: string;
  periodType?: string;
  periodStart?: string;
  periodEnd?: string;
  title?: string;
  summary?: string;
  story?: string;
  memoryWeight?: string;
  highlights?: string[];
}

export function getGrowthProfileGraphMetadata() {
  return {
    promptName: growthProfilePromptV1.name,
    promptVersion: growthProfilePromptV1.version,
  };
}

function buildMedalsContext(medals: GrowthMedalItem[]): string {
  return medals
    .map((medal, i) => {
      const parts: string[] = [];
      if (medal.experienceAt) parts.push(`发生时间：${medal.experienceAt}`);
      if (medal.createdAt) parts.push(`奖章生成时间：${medal.createdAt}`);
      if (medal.title) parts.push(`标题：${medal.title}`);
      if (medal.shortReason) parts.push(`简要理由：${medal.shortReason}`);
      if (medal.meaningFocus) parts.push(`意义聚焦：${medal.meaningFocus}`);
      if (medal.story) parts.push(`故事：${medal.story}`);
      if (medal.memoryWeight) parts.push(`记忆重量：${medal.memoryWeight}`);
      if (medal.experience) parts.push(`经历摘要：${medal.experience}`);
      return `奖章 ${i + 1}\n${parts.join("\n")}`;
    })
    .join("\n\n");
}

function buildStageSummariesContext(stages: GrowthStageSummaryItem[]): string {
  return stages
    .map((stage, i) => {
      const parts: string[] = [];
      if (stage.periodType) parts.push(`周期类型：${stage.periodType}`);
      if (stage.periodStart || stage.periodEnd) {
        parts.push(`周期：${stage.periodStart ?? ""} ~ ${stage.periodEnd ?? ""}`);
      }
      if (stage.title) parts.push(`标题：${stage.title}`);
      if (stage.summary) parts.push(`总结：${stage.summary}`);
      if (stage.story) parts.push(`故事：${stage.story}`);
      if (stage.memoryWeight) parts.push(`记忆重量：${stage.memoryWeight}`);
      if (stage.highlights && stage.highlights.length > 0) {
        parts.push(`亮点：${stage.highlights.join("、")}`);
      }
      return `阶段总结 ${i + 1}\n${parts.join("\n")}`;
    })
    .join("\n\n");
}

// parseGrowthProfile extracts and validates the JSON the LLM returns. Validation
// goes through the Zod schema so malformed output fails loudly rather than
// silently persisting half-built records.
function parseGrowthProfile(raw: string): GrowthProfileGeneration {
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
  return growthProfileSchema.parse(parsed);
}

/**
 * Generate a long-term growth profile from a user's medals and stage summaries.
 * The caller is expected to pass already-collected signals; this function only
 * cares about structured generation and validation.
 */
export async function generateGrowthProfile(
  medals: GrowthMedalItem[],
  stageSummaries: GrowthStageSummaryItem[],
  runtime?: AgentRuntimeConfig | null,
): Promise<GrowthProfileGeneration> {
  const systemPrompt = growthProfilePromptV1.template;
  const medalsText = buildMedalsContext(medals);
  const stagesText = buildStageSummariesContext(stageSummaries);

  const sections: string[] = [];
  if (medalsText) {
    sections.push(`以下是用户已记录的 ${medals.length} 枚经历奖章：\n\n${medalsText}`);
  }
  if (stagesText) {
    sections.push(`以下是用户已生成的 ${stageSummaries.length} 段阶段总结：\n\n${stagesText}`);
  }

  const userContent = `请基于以下记录提取用户的长期成长画像，保持克制与可解释：\n\n${sections.join("\n\n")}`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  const provider = getLLMProviderFromRuntime(runtime);
  const response = await provider.chat(messages);

  return parseGrowthProfile(response.content);
}

import { yearReviewPromptV1 } from "../prompts/year-review.v1.js";
import { getLLMProviderFromRuntime, type AgentRuntimeConfig } from "../providers/index.js";
import type { ChatMessage } from "../providers/types.js";
import { yearReviewSchema, type YearReviewGeneration } from "../schemas/year-review.js";

// YearMedalItem mirrors the Go API's payload for medals in year review input.
export interface YearMedalItem {
  id?: string;
  title?: string;
  shortReason?: string;
  memoryWeight?: string;
  story?: string;
  meaningFocus?: string;
  createdAt?: string;
}

// YearStageItem mirrors the Go API's payload for stage summaries in year
// review input.
export interface YearStageItem {
  periodType?: string;
  periodStart?: string;
  title?: string;
  summary?: string;
  story?: string;
  highlights?: string[];
}

// GrowthProfileSnapshot is a trimmed view of the user's growth profile. It may
// be absent for users who never refreshed their profile.
export interface GrowthProfileSnapshot {
  traitKeywords?: string[];
  growthKeywords?: string[];
  summaryText?: string;
}

export interface YearReviewStats {
  medalCount: number;
  experienceCount: number;
  stageSummaryCount: number;
}

export function getYearReviewGraphMetadata() {
  return {
    promptName: yearReviewPromptV1.name,
    promptVersion: yearReviewPromptV1.version,
  };
}

function buildMedalsContext(medals: YearMedalItem[]): string {
  return medals
    .map((medal, i) => {
      const parts: string[] = [];
      if (medal.createdAt) parts.push(`生成时间：${medal.createdAt}`);
      if (medal.title) parts.push(`标题：${medal.title}`);
      if (medal.shortReason) parts.push(`授奖理由：${medal.shortReason}`);
      if (medal.memoryWeight) parts.push(`记忆重量：${medal.memoryWeight}`);
      if (medal.meaningFocus) parts.push(`意义聚焦：${medal.meaningFocus}`);
      if (medal.story) parts.push(`故事摘要：${medal.story}`);
      return `奖章 ${i + 1}\n${parts.join("\n")}`;
    })
    .join("\n\n");
}

function buildStageSummariesContext(stages: YearStageItem[]): string {
  return stages
    .map((stage, i) => {
      const parts: string[] = [];
      if (stage.periodType) parts.push(`周期类型：${stage.periodType}`);
      if (stage.periodStart) parts.push(`周期起点：${stage.periodStart}`);
      if (stage.title) parts.push(`标题：${stage.title}`);
      if (stage.summary) parts.push(`总结：${stage.summary}`);
      if (stage.story) parts.push(`故事：${stage.story}`);
      if (stage.highlights && stage.highlights.length > 0) {
        parts.push(`亮点：${stage.highlights.join("、")}`);
      }
      return `阶段总结 ${i + 1}\n${parts.join("\n")}`;
    })
    .join("\n\n");
}

function buildGrowthProfileContext(profile: GrowthProfileSnapshot | undefined): string {
  if (!profile) return "（用户尚未生成成长画像）";
  const parts: string[] = [];
  if (profile.summaryText) parts.push(`画像总结：${profile.summaryText}`);
  if (profile.traitKeywords && profile.traitKeywords.length > 0) {
    parts.push(`人格特质：${profile.traitKeywords.join("、")}`);
  }
  if (profile.growthKeywords && profile.growthKeywords.length > 0) {
    parts.push(`成长关键词：${profile.growthKeywords.join("、")}`);
  }
  return parts.join("\n") || "（画像为空）";
}

function parseYearReview(raw: string): YearReviewGeneration {
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
  return yearReviewSchema.parse(parsed);
}

/**
 * Generate a year-level review from a user's annual medals, stage summaries
 * and growth profile snapshot. The caller collects and curates the input
 * signals; this function handles structured generation and validation.
 */
export async function generateYearReview(
  year: number,
  medals: YearMedalItem[],
  stageSummaries: YearStageItem[],
  growthProfile: GrowthProfileSnapshot | undefined,
  stats: YearReviewStats,
  runtime?: AgentRuntimeConfig | null,
): Promise<YearReviewGeneration> {
  const systemPrompt = yearReviewPromptV1.template;
  const medalsText = buildMedalsContext(medals);
  const stagesText = buildStageSummariesContext(stageSummaries);
  const profileText = buildGrowthProfileContext(growthProfile);

  const sections: string[] = [];
  sections.push(`年份：${year}`);
  sections.push(
    `年度统计：${stats.medalCount} 枚奖章、${stats.experienceCount} 段经历、${stats.stageSummaryCount} 段阶段总结`,
  );

  if (medalsText) {
    sections.push(`以下是用户在 ${year} 年记录的 ${medals.length} 枚奖章：\n\n${medalsText}`);
  }
  if (stagesText) {
    sections.push(
      `以下是用户在 ${year} 年生成的 ${stageSummaries.length} 段阶段总结：\n\n${stagesText}`,
    );
  }
  sections.push(`用户当前成长画像快照：\n${profileText}`);

  const userContent = `请基于以上记录生成 ${year} 年度回顾：\n\n${sections.join("\n\n")}`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  const provider = getLLMProviderFromRuntime(runtime);
  const response = await provider.chat(messages);

  return parseYearReview(response.content);
}

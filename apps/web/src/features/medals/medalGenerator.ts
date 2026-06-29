import { sendAgentMessage, type AgentChatMessage } from "@/features/agent/agentClient";
import type { AgentRuntimeConfig } from "@/features/agent/runtimeConfig";
import type { MedalDraft } from "./medalStore";

interface ChatMessageForMedal {
  role: "user" | "assistant";
  content: string;
}

interface AgentMedalResponse {
  title?: string;
  summary?: string;
  detail?: string;
  tags?: string[];
}

function compactTranscript(messages: ChatMessageForMedal[]) {
  return messages
    .filter((message) => message.content.trim())
    .map((message) => `${message.role === "user" ? "用户" : "Agent"}：${message.content.trim()}`)
    .join("\n");
}

function firstUserExperience(messages: ChatMessageForMedal[]) {
  return messages.find((message) => message.role === "user" && message.content.trim())?.content ?? "";
}

function parseAgentJson(raw: string): AgentMedalResponse {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1] ?? trimmed;
  const jsonStart = candidate.indexOf("{");
  const jsonEnd = candidate.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error("Agent 没有返回可解析的奖章 JSON");
  }

  return JSON.parse(candidate.slice(jsonStart, jsonEnd + 1)) as AgentMedalResponse;
}

function normalizeDraft(response: AgentMedalResponse, source: MedalDraft["source"]): MedalDraft {
  const title = response.title?.trim() || "今日经历徽章";
  const summary =
    response.summary?.trim() || "你完成了一段值得被记录和展示的真实经历。";
  const detail =
    response.detail?.trim() ||
    "这段经历中最重要的不是事件本身，而是你在其中做出的行动、感受到的变化，以及它留下的意义。";
  const tags = Array.isArray(response.tags) ? response.tags : [];

  return {
    title: title.slice(0, 24),
    summary: summary.slice(0, 90),
    detail,
    tags: tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 5),
    visibility: "public",
    source,
  };
}

export function createMockMedalDraft(messages: ChatMessageForMedal[]): MedalDraft {
  const experience = firstUserExperience(messages);
  const normalizedExperience = experience || "今天你主动记录并整理了一段经历";
  const hasProductSignal = /产品|测试|原型|体验|需求|功能|修复/.test(normalizedExperience);
  const hasTravelSignal = /旅行|城市|出发|路上|风景|探索/.test(normalizedExperience);
  const hasStudyWorkSignal = /学习|工作|完成|项目|复盘|会议|任务/.test(normalizedExperience);

  if (hasProductSignal) {
    return normalizeDraft(
      {
        title: "产品校准者",
        summary: "你发现了体验里的阻塞点，并把它推进成一次更清晰的产品优化。",
        detail: `这段经历里最值得被记住的，是你没有停留在“感觉不顺”的层面，而是把问题表达出来、验证它，并推动下一步改进。\n\n原始经历：${normalizedExperience}`,
        tags: ["产品", "体验优化", "问题发现"],
      },
      "mock",
    );
  }

  if (hasTravelSignal) {
    return normalizeDraft(
      {
        title: "城市探索者",
        summary: "你把一次移动和观察，变成了属于自己的真实记忆。",
        detail: `这段经历的价值在于你主动进入新的场景，用自己的感受重新理解一个地方，也为生活留下了更具体的画面。\n\n原始经历：${normalizedExperience}`,
        tags: ["旅行", "探索", "生活记忆"],
      },
      "mock",
    );
  }

  if (hasStudyWorkSignal) {
    return normalizeDraft(
      {
        title: "稳步推进者",
        summary: "你完成了一件具体的事，让今天拥有了明确的进展。",
        detail: `这段经历中最有成就感的部分，是你把事情向前推进了。它未必轰轰烈烈，但它构成了长期成长里很扎实的一步。\n\n原始经历：${normalizedExperience}`,
        tags: ["推进", "成长", "完成"],
      },
      "mock",
    );
  }

  return normalizeDraft(
    {
      title: "今日收藏家",
      summary: "你从日常里挑出了一段值得保留的经历，并赋予它新的意义。",
      detail: `这枚奖章记录的是一次主动回望：你没有让今天只是过去，而是把它整理成了可以被再次看见的故事。\n\n原始经历：${normalizedExperience}`,
      tags: ["日常", "记录", "自我看见"],
    },
    "mock",
  );
}

export async function generateMedalDraftWithAgent(
  config: AgentRuntimeConfig,
  messages: ChatMessageForMedal[],
): Promise<MedalDraft> {
  const transcript = compactTranscript(messages);
  const prompt = `你是“经历成就官”的奖章生成 Agent。请基于用户真实经历，生成一枚贴合经历含义的奖章。

要求：
- 只返回 JSON，不要 Markdown，不要解释。
- title 是奖章名，最多 10 个中文字。
- summary 是奖章卡片上的一句话，最多 45 个中文字。
- detail 是点击奖章后的具体情节和意义说明，要贴合经历，120-220 个中文字。
- tags 是 3-5 个短标签。
- 不要夸大事实，不要编造用户没有提到的具体事件。

返回格式：
{
  "title": "奖章名",
  "summary": "一句话摘要",
  "detail": "具体情节和意义",
  "tags": ["标签1", "标签2", "标签3"]
}

对话记录：
${transcript}`;

  const response = await sendAgentMessage(config, [
    {
      role: "user",
      content: prompt,
    },
  ] satisfies AgentChatMessage[]);

  return normalizeDraft(parseAgentJson(response), "agent");
}

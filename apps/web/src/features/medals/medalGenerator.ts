import type { MedalDraft } from "./medalStore";

interface ChatMessageForMedal {
  role: "user" | "assistant";
  content: string;
}

function firstUserExperience(messages: ChatMessageForMedal[]) {
  return (
    messages.find((message) => message.role === "user" && message.content.trim())?.content ?? ""
  );
}

function normalizeDraft(
  response: {
    title?: string;
    summary?: string;
    detail?: string;
    tags?: string[];
  },
  source: MedalDraft["source"],
): MedalDraft {
  const title = response.title?.trim() || "今日经历徽章";
  const summary = response.summary?.trim() || "你完成了一段值得被记录和展示的真实经历。";
  const detail =
    response.detail?.trim() ||
    "这段经历中最重要的不是事件本身，而是你在其中做出的行动、感受到的变化，以及它留下的意义。";
  const tags = Array.isArray(response.tags) ? response.tags : [];

  return {
    title: title.slice(0, 24),
    summary: summary.slice(0, 90),
    detail,
    tags: tags
      .map((tag) => String(tag).trim())
      .filter(Boolean)
      .slice(0, 5),
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
        detail: `这段经历里最值得被记住的，是你没有停留在"感觉不顺"的层面，而是把问题表达出来、验证它，并推动下一步改进。\n\n原始经历：${normalizedExperience}`,
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

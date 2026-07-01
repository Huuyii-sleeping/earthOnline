// Safety review — two-layer architecture.
//
// Layer 1: Fast keyword matching (1ms, no LLM call) — catches explicit
//          self-harm/violence phrases. Retained from the original implementation.
//
// Layer 2: LLM semantic check — triggered when keyword check passes but
//          the message contains potential risk signals (negative emotion
//          words, long messages with distress tone). Uses LLM to understand
//          semantic intent, catching phrases like "觉得活着没意思" that
//          keyword matching misses.
//
// Degradation: if the LLM check fails (timeout, API error), we fall back
// to the keyword check result. We never block a conversation due to a
// safety check infrastructure failure — but we always block on "high" risk.

import type { LLMProvider, ChatMessage } from "../providers/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SafetyResult {
  safe: boolean;
  reason?: string;
  safeResponse?: string;
  /** Risk level from semantic check: "none" | "low" | "high" */
  riskLevel?: "none" | "low" | "high";
  /** Whether the message should be checked by the LLM semantic layer. */
  needsSemanticCheck?: boolean;
}

// ---------------------------------------------------------------------------
// Layer 1: Keyword matching (fast, synchronous)
// ---------------------------------------------------------------------------

const SELF_HARM_KEYWORDS = [
  "不想活",
  "想死",
  "自杀",
  "自残",
  "了结",
  "结束生命",
  "kill myself",
  "suicide",
  "self-harm",
  "end my life",
];

const VIOLENCE_KEYWORDS = ["杀人", "伤害他人", "报复社会", "bomb", "attack others"];

// Negative emotion words that may indicate psychological distress.
// These don't trigger a block, but they DO trigger the LLM semantic check.
const NEGATIVE_EMOTION_SIGNALS = [
  "绝望",
  "崩溃",
  "撑不住",
  "放弃",
  "痛苦",
  "没意思",
  "活着没意义",
  "世界没有我",
  "消失",
  "解脱",
  "累了不想",
  "hopeless",
  "worthless",
  "end it all",
  "give up",
  "no point",
  "can't take it",
];

/**
 * Layer 1: Fast keyword-based safety check.
 * Returns immediately — no LLM call, no network I/O.
 *
 * If keywords are matched, returns safe=false with a safe response.
 * If no keywords matched but negative signals are present, returns
 * safe=true with needsSemanticCheck=true for Layer 2.
 */
export function checkSafety(content: string): SafetyResult {
  const lower = content.toLowerCase();

  // Self-harm keywords — immediate block
  for (const keyword of SELF_HARM_KEYWORDS) {
    if (lower.includes(keyword.toLowerCase())) {
      return {
        safe: false,
        reason: "self_harm_detected",
        riskLevel: "high",
        safeResponse:
          "我听到你说的这些，我很关心你现在的状态。你此刻的感受很重要，我建议你联系专业支持：\n\n- 全国心理援助热线：400-161-9995\n- 北京心理危机研究与干预中心：010-82951332\n\n你不是一个人，有人愿意倾听和帮助你。",
      };
    }
  }

  // Violence keywords — immediate block
  for (const keyword of VIOLENCE_KEYWORDS) {
    if (lower.includes(keyword.toLowerCase())) {
      return {
        safe: false,
        reason: "violence_detected",
        riskLevel: "high",
        safeResponse:
          "我理解你可能正在经历很大的压力和愤怒。伤害他人不是解决问题的方法，也不会让你感觉更好。如果你愿意，可以告诉我发生了什么，我们一起看看有没有其他方式来应对。",
      };
    }
  }

  // Check for negative emotion signals — trigger LLM semantic check
  const hasNegativeSignal = NEGATIVE_EMOTION_SIGNALS.some((kw) => lower.includes(kw.toLowerCase()));

  // Long messages with negative tone also warrant a semantic check
  const isLongMessage = content.length > 100;

  if (hasNegativeSignal || isLongMessage) {
    return {
      safe: true,
      riskLevel: "none",
      needsSemanticCheck: true,
    };
  }

  return { safe: true, riskLevel: "none" };
}

// ---------------------------------------------------------------------------
// Layer 2: LLM semantic safety check
// ---------------------------------------------------------------------------

const SAFETY_CHECK_PROMPT = `你是安全审查助手。判断以下用户消息是否存在安全风险。

风险类型：
- 自伤自杀：表达结束生命的意愿或计划
- 暴力倾向：表达伤害他人的意图
- 严重心理危机：极端绝望、无法承受的痛苦

判断规则：
- 用户描述过去的困难但当前状态平稳 → 无风险
- 用户表达情绪低落但无自伤意图 → 低风险（需关注）
- 用户暗示或明示自伤 → 高风险（需干预）

输出 JSON（仅输出 JSON，不要其他文字）：
{"risk_level": "none|low|high", "reason": "简短理由", "safe_response": "high时必填，温暖的干预回复"}`;

/**
 * Layer 2: LLM-powered semantic safety check.
 *
 * Called when Layer 1 (keyword check) passes but the message contains
 * potential risk signals. Uses the LLM to understand semantic intent.
 *
 * Degradation: if the LLM call fails, returns { safe: true, riskLevel: "none" }.
 * We never block a conversation due to a check infrastructure failure.
 */
export async function semanticSafetyCheck(
  provider: LLMProvider,
  content: string,
): Promise<SafetyResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: SAFETY_CHECK_PROMPT },
    { role: "user", content },
  ];

  try {
    const response = await provider.chat(messages);
    let text = response.content.trim();

    // Strip markdown code blocks if present
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const parsed = JSON.parse(text);

    const riskLevel = parsed.risk_level as "none" | "low" | "high";

    if (riskLevel === "high") {
      return {
        safe: false,
        reason: parsed.reason || "semantic_risk_detected",
        riskLevel: "high",
        safeResponse:
          parsed.safe_response ||
          "我很关心你现在的状态。如果你正在经历困难，请联系专业支持：\n\n- 全国心理援助热线：400-161-9995\n- 北京心理危机研究与干预中心：010-82951332",
      };
    }

    return {
      safe: true,
      riskLevel: riskLevel || "none",
      needsSemanticCheck: false,
    };
  } catch {
    // LLM check failed — be conservative. If Layer 1 flagged negative
    // emotion signals, we can't confirm the message is safe. Return
    // riskLevel="low" so the caller knows there's uncertainty, but
    // don't block the conversation (fail-open for usability, but
    // flag the uncertainty rather than declaring "none").
    return { safe: true, riskLevel: "low", needsSemanticCheck: false };
  }
}

// ---------------------------------------------------------------------------
// Combined check helper
// ---------------------------------------------------------------------------

/**
 * Run both layers of safety check.
 *
 * 1. Layer 1 (keyword) — always runs, synchronous.
 * 2. Layer 2 (semantic) — only runs if Layer 1 passes but flags
 *    needsSemanticCheck=true.
 *
 * If Layer 2 fails (timeout, API error), the conversation proceeds with
 * the Layer 1 result.
 */
export async function fullSafetyCheck(
  provider: LLMProvider,
  content: string,
): Promise<SafetyResult> {
  // Layer 1
  const layer1 = checkSafety(content);
  if (!layer1.safe) {
    return layer1;
  }

  // Layer 2 (only if flagged)
  if (layer1.needsSemanticCheck) {
    const layer2 = await semanticSafetyCheck(provider, content);
    if (!layer2.safe) {
      return layer2;
    }
    // Return layer2 (not layer1) — it has the correct riskLevel and
    // needsSemanticCheck=false. Returning layer1 would discard the
    // LLM's risk assessment and leave needsSemanticCheck=true.
    return layer2;
  }

  return layer1;
}

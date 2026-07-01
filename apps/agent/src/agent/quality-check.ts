/**
 * Output quality checking — two-tier evaluation + retry.
 *
 * Tier 1: Rule-based checks (synchronous, no LLM call)
 *   - Format violations (numbered lists, excessive length)
 *   - Missing follow-up question in PROBE state
 *   - Empty chicken-soup replies
 *
 * Tier 2: LLM-as-judge (only triggered when Tier 1 finds low-severity issues)
 *   - Relevance scoring
 *   - Empathy assessment
 *   - Should-retry decision
 *
 * Retry: if quality check fails, the agent loop appends a correction
 * message and regenerates the reply. Max 1 retry — if the second attempt
 * still fails, the original reply is returned.
 */

import type { LLMProvider, ChatMessage } from "../providers/types.js";
import type { ConversationState } from "../agent/conversation-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QualityIssue {
  type: "format" | "relevance" | "safety";
  description: string;
  severity: "low" | "high";
}

export interface QualityResult {
  passed: boolean;
  issues: QualityIssue[];
}

// ---------------------------------------------------------------------------
// Tier 1: Rule-based checks
// ---------------------------------------------------------------------------

// Chicken-soup phrases that indicate a low-quality, generic response
const CHICKEN_SOUP_KEYWORDS = [
  "加油",
  "你一定可以",
  "相信自己",
  "永远不要放弃",
  "相信自己是最棒的",
  "你是独一无二的",
];

/**
 * Check reply quality using fast, synchronous rules.
 * No LLM call — pure text analysis.
 */
export function checkReplyQuality(
  reply: string,
  context: {
    state: ConversationState;
    userMessage: string;
  },
): QualityResult {
  const issues: QualityIssue[] = [];

  // --- Format checks ---

  // Numbered list detection: "1." "1、" "一、" "1)" at line start
  if (/^\s*[\d一二三四五六七八九十][.、)]/m.test(reply)) {
    issues.push({
      type: "format",
      description: "回复包含编号列表，应使用自然语言",
      severity: "high",
    });
  }

  // Excessive length
  if (reply.length > 500) {
    issues.push({
      type: "format",
      description: "回复过长（超过500字）",
      severity: "low",
    });
  }

  // --- Relevance checks ---

  // In PROBE state, the reply should contain a question
  if (context.state === "PROBE") {
    const hasQuestion = reply.includes("?") || reply.includes("？");
    if (!hasQuestion) {
      issues.push({
        type: "relevance",
        description: "PROBE 阶段没有提出追问",
        severity: "high",
      });
    }
  }

  // Empty or too-short replies
  if (reply.trim().length < 5) {
    issues.push({
      type: "relevance",
      description: "回复过短或为空",
      severity: "high",
    });
  }

  // Chicken-soup check — only flag if the reply is short AND contains cliché phrases
  if (reply.length < 80) {
    const hasChickenSoup = CHICKEN_SOUP_KEYWORDS.some((kw) => reply.includes(kw));
    if (hasChickenSoup) {
      issues.push({
        type: "relevance",
        description: "回复过于鸡汤，缺乏实质内容",
        severity: "low",
      });
    }
  }

  return {
    passed: issues.length === 0,
    issues,
  };
}

// ---------------------------------------------------------------------------
// Tier 2: LLM-as-judge
// ---------------------------------------------------------------------------

const JUDGE_PROMPT = `评估以下 Agent 回复的质量。

用户消息：{userMessage}
Agent 回复：{reply}
对话阶段：{state}

评分维度（1-5）：
1. 相关性：回复与用户消息相关
2. 格式：符合要求（无编号列表，每次一个问题）
3. 共情：表达理解，不过度鸡汤

输出 JSON（仅输出 JSON）：
{"score": 1到5的整数, "issues": ["问题1", "问题2"], "should_retry": true或false}`;

/**
 * Use LLM-as-judge to evaluate reply quality.
 * Only called when Tier 1 finds low-severity issues (high-severity issues
 * trigger a direct retry without LLM evaluation).
 */
export async function llmJudgeQuality(
  provider: LLMProvider,
  reply: string,
  context: {
    state: ConversationState;
    userMessage: string;
  },
): Promise<QualityResult> {
  const prompt = JUDGE_PROMPT.replace("{userMessage}", context.userMessage.slice(0, 200))
    .replace("{reply}", reply.slice(0, 500))
    .replace("{state}", context.state);

  const messages: ChatMessage[] = [
    { role: "system", content: prompt },
    { role: "user", content: "请评估。" },
  ];

  try {
    const response = await provider.chat(messages);
    let text = response.content.trim();

    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const parsed = JSON.parse(text);

    // Explicit type check — LLM may return "true"/"false" as strings
    const shouldRetry = parsed.should_retry === true;
    const issues: QualityIssue[] = Array.isArray(parsed.issues)
      ? parsed.issues
          .filter((desc: unknown): desc is string => typeof desc === "string")
          .map((desc: string) => ({
            type: "relevance" as const,
            description: desc,
            severity: "low" as const,
          }))
      : [];

    return {
      passed: !shouldRetry && issues.length === 0,
      issues,
    };
  } catch {
    // LLM judge failed — assume the reply is acceptable.
    return { passed: true, issues: [] };
  }
}

// ---------------------------------------------------------------------------
// Combined quality check
// ---------------------------------------------------------------------------

/**
 * Run quality check on a reply.
 *
 * 1. Tier 1 (rules) — always runs.
 * 2. Tier 2 (LLM judge) — only if Tier 1 finds low-severity issues
 *    (high-severity issues skip the LLM judge and go straight to retry).
 *
 * @returns QualityResult with all issues found.
 */
export async function checkQuality(
  provider: LLMProvider,
  reply: string,
  context: {
    state: ConversationState;
    userMessage: string;
  },
): Promise<QualityResult> {
  // Tier 1: rules
  const tier1 = checkReplyQuality(reply, context);

  if (tier1.passed) {
    return tier1;
  }

  // If only high-severity issues, skip LLM judge — retry directly
  const hasHighSeverity = tier1.issues.some((i) => i.severity === "high");
  const hasLowSeverity = tier1.issues.some((i) => i.severity === "low");

  if (hasHighSeverity && !hasLowSeverity) {
    return tier1;
  }

  // Has low-severity issues — get LLM judge opinion
  const tier2 = await llmJudgeQuality(provider, reply, context);

  // Merge: combine tier1 high-severity issues with tier2 results
  const allIssues = [...tier1.issues.filter((i) => i.severity === "high"), ...tier2.issues];

  return {
    passed: tier2.passed && !hasHighSeverity,
    issues: allIssues,
  };
}

/**
 * Build a correction message for the retry attempt.
 * Tells the LLM what was wrong with its previous reply.
 */
export function buildCorrectionMessage(issues: QualityIssue[]): string {
  const descriptions = issues.map((i) => i.description).join("；");
  return `上一次回复存在以下问题：${descriptions}。请修正这些问题，重新回复。`;
}

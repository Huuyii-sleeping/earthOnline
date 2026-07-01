/**
 * Conversation state machine — gives the Agent "dialogue phase" awareness.
 *
 * Instead of using the same prompt for every turn, the Agent knows whether
 * it's in the initial intake, probing for details, reflecting understanding,
 * or ready to generate. Each state has a tailored prompt and strategy.
 *
 * State flow:
 *   INTAKE → PROBE → REFLECT → READY → GENERATING
 *
 * The state is stored in the Go API's conversation_sessions table and passed
 * to the Agent on each turn. The Agent uses the state to select a prompt,
 * and returns the updated state to the Go API.
 */

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export type ConversationState =
  | "INTAKE" // User is describing their experience for the first time
  | "PROBE" // Agent is asking follow-up questions about details
  | "REFLECT" // Agent is restating its understanding to confirm accuracy
  | "READY" // Both sides agree there's enough to generate a summary
  | "GENERATING"; // Summary/medal generation is in progress (no more chat)

// ---------------------------------------------------------------------------
// State context — tracks the conversation's progress
// ---------------------------------------------------------------------------

export interface StateContext {
  state: ConversationState;
  turnCount: number; // Total turns in this session
  probeCount: number; // Turns spent in PROBE state
  collectedDimensions: string[]; // Dimensions already probed: action/emotion/meaning
}

export function initialState(): StateContext {
  return {
    state: "INTAKE",
    turnCount: 0,
    probeCount: 0,
    collectedDimensions: [],
  };
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

/** Keywords that signal the user wants to skip ahead to generation. */
const GENERATE_KEYWORDS = [
  "生成奖章",
  "直接生成",
  "可以了",
  "总结",
  "差不多了",
  "generate medal",
  "ready",
  "summarize",
];

/** Keywords that signal the user is correcting the Agent's understanding. */
const CORRECTION_KEYWORDS = [
  "不是",
  "不对",
  "搞错了",
  "说错了",
  "其实是",
  "no",
  "not right",
  "actually",
];

/**
 * Check if a string contains any of the keywords (case-insensitive).
 */
function containsKeyword(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

/**
 * Detect which dimension a PROBE turn covered based on the Agent's reply.
 * This helps avoid re-asking the same dimension.
 */
function detectDimension(agentReply: string): string | null {
  const reply = agentReply.toLowerCase();

  if (
    reply.includes("怎么") ||
    reply.includes("如何") ||
    reply.includes("过程") ||
    reply.includes("具体") ||
    reply.includes("做了什么") ||
    reply.includes("happen")
  ) {
    return "action";
  }
  if (
    reply.includes("感受") ||
    reply.includes("情绪") ||
    reply.includes("感觉") ||
    reply.includes("心情") ||
    reply.includes("feel") ||
    reply.includes("emotion")
  ) {
    return "emotion";
  }
  if (
    reply.includes("意义") ||
    reply.includes("为什么") ||
    reply.includes("重要") ||
    reply.includes("影响") ||
    reply.includes("meaning") ||
    reply.includes("why")
  ) {
    return "meaning";
  }

  return null;
}

/**
 * Compute the next state based on the current state, user message, and
 * Agent reply. This is a pure function — no side effects.
 *
 * Transition rules:
 * - INTAKE + user provides >30 chars → PROBE
 * - INTAKE + user says "generate" → READY
 * - PROBE + probeCount >= 3 → REFLECT (auto-transition after 3 probes)
 * - PROBE + user says "generate" → READY
 * - REFLECT + user confirms → READY
 * - REFLECT + user corrects → PROBE (reset probeCount)
 * - Any + user says "generate" → READY
 */
export function transition(
  current: StateContext,
  userMessage: string,
  agentReply: string,
): StateContext {
  const next: StateContext = { ...current };
  next.turnCount = current.turnCount + 1;

  // Universal escape hatch: user can always skip to READY.
  if (containsKeyword(userMessage, GENERATE_KEYWORDS)) {
    next.state = "READY";
    return next;
  }

  switch (current.state) {
    case "INTAKE":
      // Move to PROBE once the user has provided a substantive description.
      if (userMessage.length > 30) {
        next.state = "PROBE";
        next.probeCount = 0;
      }
      // If the user provides a very short first message, stay in INTAKE
      // and let the Agent encourage them to share more.
      break;

    case "PROBE":
      next.probeCount = current.probeCount + 1;

      // Track which dimension was probed.
      const dimension = detectDimension(agentReply);
      if (dimension && !next.collectedDimensions.includes(dimension)) {
        next.collectedDimensions = [...next.collectedDimensions, dimension];
      }

      // Auto-transition to REFLECT after 3 probes, or if all 3 dimensions
      // have been covered.
      if (next.probeCount >= 3 || next.collectedDimensions.length >= 3) {
        next.state = "REFLECT";
      }
      break;

    case "REFLECT":
      // If the user corrects the Agent's understanding, go back to PROBE.
      if (containsKeyword(userMessage, CORRECTION_KEYWORDS)) {
        next.state = "PROBE";
        next.probeCount = 0;
      } else {
        // Assume confirmation (or at least no objection) → READY.
        next.state = "READY";
      }
      break;

    case "READY":
      // Stay in READY until generation starts.
      break;

    case "GENERATING":
      // Terminal state — no transitions out.
      break;
  }

  return next;
}

// ---------------------------------------------------------------------------
// State-specific prompts
// ---------------------------------------------------------------------------

const INTAKE_PROMPT_SUFFIX = `
当前对话阶段：初次收集（INTAKE）
用户刚开始描述经历。你的策略：
- 温和鼓励用户分享更多
- 不要追问细节，先让用户把整体讲出来
- 如果用户只说了一两句话，用开放性问题引导展开`;

const PROBE_PROMPT_SUFFIX = `
当前对话阶段：追问细节（PROBE）
你在追问经历的细节。你的策略：
- 每次只问一个维度的问题
- 维度顺序：行动（怎么做的）→ 情绪（什么感受）→ 意义（为什么重要）
- 已收集的维度：{collectedDimensions}
- 已追问轮数：{probeCount}/3
- 追问 2-3 轮后自然过渡到确认阶段`;

const REFLECT_PROMPT_SUFFIX = `
当前对话阶段：复述确认（REFLECT）
你的策略：
- 用"我听到你说的是..."开头复述你的理解
- 确认经历的核心事实、情绪和意义
- 如果用户纠正了你的理解，回到追问阶段`;

const READY_PROMPT_SUFFIX = `
当前对话阶段：准备生成（READY）
信息已充分收集。你的策略：
- 简短确认对话已经完成
- 引导用户点击"生成总结"按钮
- 不要再追问新问题`;

const GENERATING_PROMPT_SUFFIX = `
当前对话阶段：生成中（GENERATING）
正在生成总结或奖章。不需要对话回复。`;

/**
 * Get the state-specific prompt suffix to append to the base system prompt.
 * The base prompt defines the Agent's role; the suffix defines the strategy
 * for the current state.
 */
export function getPromptSuffixForState(state: ConversationState, context?: StateContext): string {
  switch (state) {
    case "INTAKE":
      return INTAKE_PROMPT_SUFFIX;
    case "PROBE":
      return PROBE_PROMPT_SUFFIX.replace(
        "{collectedDimensions}",
        context?.collectedDimensions.join("、") || "无",
      ).replace("{probeCount}", String(context?.probeCount ?? 0));
    case "REFLECT":
      return REFLECT_PROMPT_SUFFIX;
    case "READY":
      return READY_PROMPT_SUFFIX;
    case "GENERATING":
      return GENERATING_PROMPT_SUFFIX;
    default:
      return "";
  }
}

/**
 * Build the full system prompt: base template + state-specific suffix.
 */
export function buildSystemPrompt(basePrompt: string, context: StateContext): string {
  const suffix = getPromptSuffixForState(context.state, context);
  return suffix ? `${basePrompt}\n\n${suffix}` : basePrompt;
}

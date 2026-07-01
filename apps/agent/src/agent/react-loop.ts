/**
 * ReAct (Reason → Act → Observe) agent loop.
 *
 * This is the core orchestration that transforms single-shot LLM calls into
 * multi-step reasoning. The loop works as follows:
 *
 * 1. REASON: Send the conversation + tool definitions to the LLM.
 * 2. ACT: If the LLM requests tool calls, execute them.
 * 3. OBSERVE: Feed tool results back to the LLM as tool-role messages.
 * 4. REPEAT until the LLM produces a final text reply (no tool calls) or
 *    the max iteration limit is reached.
 *
 * This enables the Agent to:
 * - Decide on its own whether it needs more context (e.g., "let me check
 *   what medals this user already has before I ask a follow-up question")
 * - Make multiple tool calls in a single reasoning step
 * - Chain tool calls across iterations (e.g., check medals → check growth
 *   profile → synthesize a personalized response)
 *
 * Design decisions:
 * - Max 3 iterations: prevents infinite loops and controls cost. Most
 *   conversations need 0-1 tool calls; 3 is a generous ceiling.
 * - Tool results are truncated to 2000 chars: prevents context window
 *   bloat from large API responses.
 * - The loop yields intermediate reasoning for observability (logging),
 *   not for streaming to the user. The final reply is streamed separately.
 */

import type { ChatMessage, LLMProvider, LLMResponse, ToolContext } from "../providers/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import { checkSafety } from "../safety/index.js";

const MAX_ITERATIONS = 3;
const MAX_TOOL_RESULT_LENGTH = 2000;

export interface ReActStep {
  /** "reasoning" | "tool_call" | "tool_result" | "final" */
  type: "reasoning" | "tool_call" | "tool_result" | "final";
  /** The LLM's text content or a summary of the tool call/result. */
  content: string;
}

export interface ReActResult {
  /** The final text reply from the LLM (what the user sees). */
  reply: string;
  /** Whether the LLM indicated the conversation is ready for summary generation. */
  done: boolean;
  /** Steps taken during the loop (for logging/debugging). */
  steps: ReActStep[];
  /** Whether any tool calls were made. */
  usedTools: boolean;
}

/**
 * Truncate a string to maxLen, adding an ellipsis if truncated.
 * Prevents large API responses from blowing up the context window.
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "\n...(结果已截断)";
}

/**
 * Detect whether the LLM's reply indicates readiness for summary generation.
 * This is a heuristic that combines keyword matching with the LLM's own
 * judgment — if the model explicitly says "ready" or the user said "generate",
 * we trust that signal.
 */
function detectReadiness(reply: string, userMessage: string): boolean {
  const userWantsGenerate = ["生成奖章", "直接生成", "可以了", "总结", "generate medal"].some(
    (kw) => userMessage.toLowerCase().includes(kw.toLowerCase()),
  );

  const agentThinksReady = ["总结", "准备好了", "可以生成", "ready to generate", "summary"].some(
    (kw) => reply.toLowerCase().includes(kw.toLowerCase()),
  );

  return userWantsGenerate || agentThinksReady;
}

/**
 * Run the ReAct loop for a conversation turn.
 *
 * @param provider - LLM provider with tool-calling support
 * @param tools - Tool registry (may be null if no tools are available)
 * @param systemPrompt - The system prompt for the conversation
 * @param history - Prior conversation history
 * @param userMessage - The user's current message
 * @param context - Tool execution context (userId, sessionId)
 * @returns ReActResult with the final reply and execution trace
 */
export async function runReActLoop(
  provider: LLMProvider,
  tools: ToolRegistry | null,
  systemPrompt: string,
  history: { role: "user" | "assistant"; content: string }[],
  userMessage: string,
  context?: ToolContext,
): Promise<ReActResult> {
  const steps: ReActStep[] = [];

  // Safety check — short-circuit before any LLM call.
  const safety = checkSafety(userMessage);
  if (!safety.safe) {
    return {
      reply: safety.safeResponse!,
      done: false,
      steps: [{ type: "final", content: "Safety check triggered" }],
      usedTools: false,
    };
  }

  // Build the initial message array.
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({
      role: h.role === "user" ? ("user" as const) : ("assistant" as const),
      content: h.content,
    })),
    { role: "user", content: userMessage },
  ];

  // Get tool definitions (empty array if no tools registered).
  const toolDefs = tools?.getDefinitions() ?? [];

  let lastResponse: LLMResponse | null = null;
  let usedTools = false;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // --- REASON: Ask the LLM what to do next ---
    let response: LLMResponse;

    if (toolDefs.length > 0) {
      response = await provider.chatWithTools(messages, toolDefs);
    } else {
      // No tools available — fall back to plain chat.
      response = await provider.chat(messages);
    }

    lastResponse = response;

    // If the LLM didn't request any tool calls, we have our final answer.
    if (!response.tool_calls || response.tool_calls.length === 0) {
      steps.push({
        type: "final",
        content: response.content.slice(0, 200),
      });
      break;
    }

    // --- ACT: The LLM wants to call tools ---
    usedTools = true;
    steps.push({
      type: "tool_call",
      content: response.tool_calls.map((tc) => tc.function.name).join(", "),
    });

    // Add the assistant's tool-call message to the conversation so the
    // LLM sees its own request in the next iteration.
    messages.push({
      role: "assistant",
      content: response.content || "",
      tool_calls: response.tool_calls,
    });

    // Execute all requested tool calls.
    if (tools) {
      const results = await tools.executeAll(response.tool_calls, context);

      // --- OBSERVE: Feed tool results back to the LLM ---
      for (const call of response.tool_calls) {
        const result = results.get(call.id) ?? '{"error": "No result"}';
        const truncated = truncate(result, MAX_TOOL_RESULT_LENGTH);

        messages.push({
          role: "tool",
          content: truncated,
          tool_call_id: call.id,
          name: call.function.name,
        });

        steps.push({
          type: "tool_result",
          content: `${call.function.name}: ${truncated.slice(0, 100)}`,
        });
      }
    }

    // Loop continues — the LLM will see the tool results and either
    // call more tools or produce a final reply.
  }

  // If we exhausted all iterations without a final reply, use whatever
  // content we have from the last response.
  const finalReply = lastResponse?.content || "抱歉，我暂时无法回复。";
  const done = detectReadiness(finalReply, userMessage);

  return {
    reply: finalReply,
    done,
    steps,
    usedTools,
  };
}

/**
 * Streaming version of the conversation turn.
 *
 * For now, streaming doesn't support tool calling — tools require the
 * complete structured response. So we run a hybrid approach:
 * 1. First, run the ReAct loop (non-streaming) to handle any tool calls.
 * 2. If tools were used, yield the final reply as a single chunk.
 * 3. If no tools were used, stream the response normally for low latency.
 *
 * This gives us the best of both worlds: tool-calling intelligence when
 * needed, streaming responsiveness when not.
 */
export async function* streamConversationWithTools(
  provider: LLMProvider,
  tools: ToolRegistry | null,
  systemPrompt: string,
  history: { role: "user" | "assistant"; content: string }[],
  userMessage: string,
  context?: ToolContext,
): AsyncGenerator<string, void, unknown> {
  // Safety check
  const safety = checkSafety(userMessage);
  if (!safety.safe) {
    yield safety.safeResponse!;
    return;
  }

  const toolDefs = tools?.getDefinitions() ?? [];

  // If tools are available, try the ReAct loop first.
  if (toolDefs.length > 0) {
    // Quick check: does the user message suggest they need tool context?
    // Simple greetings or short messages don't need tool calls.
    const needsContext = shouldUseTools(userMessage, history);

    if (needsContext) {
      const result = await runReActLoop(
        provider,
        tools,
        systemPrompt,
        history,
        userMessage,
        context,
      );

      if (result.usedTools) {
        // Yield the final reply as a single chunk — it was produced
        // after tool reasoning, so streaming it token-by-token would
        // require a second LLM call which isn't worth the latency.
        yield result.reply;
        return;
      }

      // If tools were available but not used, the ReAct loop already
      // got a final reply. Yield it.
      if (result.reply) {
        yield result.reply;
        return;
      }
    }
  }

  // Fall through to plain streaming (no tools).
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({
      role: h.role === "user" ? ("user" as const) : ("assistant" as const),
      content: h.content,
    })),
    { role: "user", content: userMessage },
  ];

  yield* provider.stream(messages);
}

/**
 * Heuristic: decide whether the user's message warrants tool calls.
 *
 * Simple greetings ("你好", "hi") and very short messages (< 10 chars)
 * don't need the overhead of a tool-calling round-trip. The LLM can
 * respond directly.
 *
 * Messages that reference past experiences, ask about history, or are
 * long enough to be a substantive experience description are good
 * candidates for tool enrichment.
 */
function shouldUseTools(
  userMessage: string,
  history: { role: "user" | "assistant"; content: string }[],
): boolean {
  const msg = userMessage.trim().toLowerCase();

  // Short greetings / acknowledgements — no tools needed.
  const simpleMessages = ["你好", "hi", "hello", "嘿", "嗯", "好的", "ok", "谢谢"];
  if (simpleMessages.some((s) => msg === s || msg === s + "。")) {
    return false;
  }

  // Very first message (no history) and short — probably just starting.
  if (history.length === 0 && userMessage.length < 15) {
    return false;
  }

  // Messages that reference history or ask about existing data.
  const historyKeywords = ["之前", "上次", "已经", "以前", "历史", "previous", "last time"];
  if (historyKeywords.some((kw) => msg.includes(kw))) {
    return true;
  }

  // Substantive experience descriptions (longer messages) — tools can
  // help personalize the response.
  if (userMessage.length > 50) {
    return true;
  }

  return false;
}

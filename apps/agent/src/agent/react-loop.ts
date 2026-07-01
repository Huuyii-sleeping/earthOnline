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
 * Two versions are provided:
 * - runReActLoop: non-streaming, returns a complete ReActResult.
 * - runReActLoopStream: streaming, yields StreamChunks for SSE.
 *
 * The streaming version uses the two-phase approach:
 * - Phase 1: non-streaming chatWithTools to decide if tools are needed.
 *   If tools are needed, execute them and loop back.
 * - Phase 2: stream the final reply token by token after tool execution.
 * - If no tools are needed in phase 1, the content is yielded directly
 *   (no second LLM call).
 */

import type {
  ChatMessage,
  LLMProvider,
  LLMResponse,
  StreamChunk,
  ToolContext,
} from "../providers/types.js";
import { ToolCallingNotSupportedError, isToolCallingError } from "../providers/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import { checkSafety } from "../safety/index.js";
import { runPromptBasedToolLoop } from "./prompt-tools.js";

const MAX_ITERATIONS = 3;
const MAX_TOOL_RESULT_LENGTH = 2000;

export interface ReActStep {
  type: "reasoning" | "tool_call" | "tool_result" | "final";
  content: string;
}

export interface ReActResult {
  reply: string;
  done: boolean;
  steps: ReActStep[];
  usedTools: boolean;
}

/**
 * Truncate a string to maxLen, adding an ellipsis if truncated.
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "\n...(结果已截断)";
}

/**
 * Detect whether the LLM's reply indicates readiness for summary generation.
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
 * Build the message array from system prompt, history, and user message.
 * Extracted as a shared helper for both streaming and non-streaming paths.
 */
function buildMessages(
  systemPrompt: string,
  history: { role: "user" | "assistant"; content: string }[],
  userMessage: string,
  summary?: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

  if (summary) {
    messages.push({
      role: "system",
      content: `之前的对话摘要：\n${summary}`,
    });
  }

  messages.push(
    ...history.map((h) => ({
      role: h.role === "user" ? ("user" as const) : ("assistant" as const),
      content: h.content,
    })),
  );
  messages.push({ role: "user", content: userMessage });

  return messages;
}

// ---------------------------------------------------------------------------
// Non-streaming ReAct loop (for non-streaming endpoints)
// ---------------------------------------------------------------------------

export async function runReActLoop(
  provider: LLMProvider,
  tools: ToolRegistry | null,
  systemPrompt: string,
  history: { role: "user" | "assistant"; content: string }[],
  userMessage: string,
  context?: ToolContext,
  summary?: string,
): Promise<ReActResult> {
  const steps: ReActStep[] = [];

  const safety = checkSafety(userMessage);
  if (!safety.safe) {
    return {
      reply: safety.safeResponse!,
      done: false,
      steps: [{ type: "final", content: "Safety check triggered" }],
      usedTools: false,
    };
  }

  const messages = buildMessages(systemPrompt, history, userMessage, summary);
  const toolDefs = tools?.getDefinitions() ?? [];

  let lastResponse: LLMResponse | null = null;
  let usedTools = false;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    let response: LLMResponse;

    if (toolDefs.length > 0) {
      response = await provider.chatWithTools(messages, toolDefs);
    } else {
      response = await provider.chat(messages);
    }

    lastResponse = response;

    if (!response.tool_calls || response.tool_calls.length === 0) {
      steps.push({ type: "final", content: response.content.slice(0, 200) });
      break;
    }

    usedTools = true;
    steps.push({
      type: "tool_call",
      content: response.tool_calls.map((tc) => tc.function.name).join(", "),
    });

    messages.push({
      role: "assistant",
      content: response.content || "",
      tool_calls: response.tool_calls,
    });

    if (tools) {
      const results = await tools.executeAll(response.tool_calls, context);

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
  }

  // If we exhausted all iterations (model kept requesting tools), get a
  // final reply without tools — same pattern as the streaming version.
  if (usedTools && (!lastResponse?.content || lastResponse.content.trim() === "")) {
    const finalResponse = await provider.chat(messages);
    lastResponse = finalResponse;
  }

  const finalReply = lastResponse?.content || "抱歉，我暂时无法回复。";
  const done = detectReadiness(finalReply, userMessage);

  return { reply: finalReply, done, steps, usedTools };
}

// ---------------------------------------------------------------------------
// Streaming ReAct loop (for SSE endpoints)
// ---------------------------------------------------------------------------

/**
 * Run the ReAct loop in streaming mode.
 *
 * Yields StreamChunks that the caller forwards to the SSE client:
 * - `{ type: "tool_calls" }`: tools are being called. The caller can show
 *   a "thinking..." indicator to the user.
 * - `{ type: "token" }`: a text token from the final reply. Forward directly.
 * - `{ type: "done" }`: the loop is complete.
 *
 * The key difference from runReActLoop: after tool execution, the final
 * reply is streamed token by token via `provider.streamFinalReply()`,
 * giving the user real-time typing feedback even when tools were used.
 */
export async function* runReActLoopStream(
  provider: LLMProvider,
  tools: ToolRegistry | null,
  systemPrompt: string,
  history: { role: "user" | "assistant"; content: string }[],
  userMessage: string,
  context?: ToolContext,
  summary?: string,
): AsyncGenerator<StreamChunk, void, unknown> {
  // Safety check — short-circuit before any LLM call.
  const safety = checkSafety(userMessage);
  if (!safety.safe) {
    yield { type: "token", content: safety.safeResponse! };
    yield { type: "done", finish_reason: "safety" };
    return;
  }

  const messages = buildMessages(systemPrompt, history, userMessage, summary);
  const toolDefs = tools?.getDefinitions() ?? [];

  // If no tools are available, skip the tool-calling logic entirely
  // and stream directly for lowest latency.
  if (toolDefs.length === 0) {
    yield* provider.streamFinalReply(messages);
    return;
  }

  // Heuristic: most messages don't need tool calls. Simple greetings,
  // short replies, and messages without history references can be
  // streamed directly — this keeps TTFT (time to first token) low.
  //
  // Only substantive messages (>50 chars) or history-referencing messages
  // go through the tool-calling path, which requires a non-streaming
  // chatWithTools call first (adding 2-5s latency).
  if (!shouldUseTools(userMessage, history)) {
    yield* provider.streamFinalReply(messages);
    return;
  }

  // --- ReAct loop with two-phase streaming ---
  // Wrapped in try-catch to handle models that don't support native
  // function calling — falls back to prompt-based tool calling.

  try {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      // Phase 1: non-streaming check — does the model want tools?
      const chunkIterator = provider.streamWithTools(messages, toolDefs);
      const firstChunk = (await chunkIterator.next()).value;

      if (!firstChunk) {
        yield { type: "token", content: "抱歉，我暂时无法回复。" };
        yield { type: "done", finish_reason: "error" };
        return;
      }

      // If the model wants tools, execute them and loop back.
      if (firstChunk.type === "tool_calls") {
        const toolCalls = firstChunk.tool_calls;

        // Yield the tool_calls chunk so the caller (SSE handler) can
        // show a "thinking" indicator to the user.
        yield firstChunk;

        // Add the assistant's tool-call message to the conversation.
        messages.push({
          role: "assistant",
          content: "",
          tool_calls: toolCalls,
        });

        // Execute all requested tool calls.
        if (tools) {
          const results = await tools.executeAll(toolCalls, context);

          for (const call of toolCalls) {
            const result = results.get(call.id) ?? '{"error": "No result"}';
            const truncated = truncate(result, MAX_TOOL_RESULT_LENGTH);

            messages.push({
              role: "tool",
              content: truncated,
              tool_call_id: call.id,
              name: call.function.name,
            });
          }
        }

        // Loop back — the model will see tool results and either call more
        // tools or produce a final reply.
        continue;
      }

      // The model produced a final reply (no tool calls).
      // firstChunk is either "token" or "done".
      if (firstChunk.type === "token") {
        yield firstChunk;
      }

      // Consume any remaining chunks (there should be a "done" chunk).
      for await (const chunk of chunkIterator) {
        if (chunk.type === "token") {
          yield chunk;
        } else if (chunk.type === "done") {
          yield chunk;
        }
      }

      return;
    }

    // Exhausted all iterations — the model kept requesting tools.
    // Force a final streaming reply without tools.
    yield* provider.streamFinalReply(messages);
  } catch (err) {
    // If the model doesn't support native function calling, fall back to
    // prompt-based tool calling (embeds tool definitions in the system prompt
    // and parses tool calls from the model's text output).
    if (err instanceof ToolCallingNotSupportedError || isToolCallingError(err)) {
      if (tools) {
        yield* runPromptBasedToolLoop(provider, tools, messages, context);
        return;
      }
    }

    // Re-throw other errors
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Convenience wrapper (kept for backward compatibility)
// ---------------------------------------------------------------------------

/**
 * Streaming conversation with tool support.
 *
 * This is a thin wrapper around runReActLoopStream that yields plain
 * strings (tokens only), filtering out non-token chunks. Used by
 * conversation.graph.ts for the streamConversation function.
 *
 * The route handler should use runReActLoopStream directly if it needs
 * access to tool_calls chunks (for "thinking" indicators).
 */
export async function* streamConversationWithTools(
  provider: LLMProvider,
  tools: ToolRegistry | null,
  systemPrompt: string,
  history: { role: "user" | "assistant"; content: string }[],
  userMessage: string,
  context?: ToolContext,
  summary?: string,
): AsyncGenerator<string, void, unknown> {
  for await (const chunk of runReActLoopStream(
    provider,
    tools,
    systemPrompt,
    history,
    userMessage,
    context,
    summary,
  )) {
    if (chunk.type === "token") {
      yield chunk.content;
    }
  }
}

/**
 * Heuristic: decide whether the user's message warrants tool calls.
 *
 * Simple greetings ("你好", "hi") and very short messages don't need
 * the overhead of a tool-calling round-trip.
 */
export function shouldUseTools(
  userMessage: string,
  history: { role: "user" | "assistant"; content: string }[],
): boolean {
  const msg = userMessage.trim().toLowerCase();

  const simpleMessages = ["你好", "hi", "hello", "嘿", "嗯", "好的", "ok", "谢谢"];
  if (simpleMessages.some((s) => msg === s || msg === s + "。")) {
    return false;
  }

  if (history.length === 0 && userMessage.length < 15) {
    return false;
  }

  const historyKeywords = ["之前", "上次", "已经", "以前", "历史", "previous", "last time"];
  if (historyKeywords.some((kw) => msg.includes(kw))) {
    return true;
  }

  if (userMessage.length > 50) {
    return true;
  }

  return false;
}

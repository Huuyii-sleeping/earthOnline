/**
 * Prompt-based tool calling fallback.
 *
 * When the model doesn't support native function calling (some Zhipu GLM
 * versions, older models, etc.), we embed tool definitions in the system
 * prompt and parse tool calls from the model's text output.
 *
 * The model is instructed to output a JSON block when it wants to call
 * a tool:
 *   {"tool_calls": [{"name": "query_user_medals", "args": {"limit": 5}}]}
 *
 * This is less reliable than native function calling (the model may
 * produce malformed JSON), but it works with any text-capable model.
 */

import type {
  ChatMessage,
  LLMProvider,
  StreamChunk,
  ToolDefinition,
  ToolContext,
} from "../providers/types.js";
import type { ToolRegistry } from "../tools/registry.js";

const MAX_ITERATIONS = 3;
const MAX_TOOL_RESULT_LENGTH = 2000;

/**
 * Build the prompt suffix that describes available tools.
 * Appended to the system prompt so the model knows how to "call" tools.
 */
export function buildToolPrompt(tools: ToolDefinition[]): string {
  if (tools.length === 0) return "";

  const toolDescriptions = tools
    .map((t) => `- ${t.function.name}: ${t.function.description}`)
    .join("\n");

  return `
你可以使用以下工具来获取用户的背景信息。需要调用工具时，在回复的最开头输出 JSON 格式的工具调用，然后换行：

{"tool_calls": [{"name": "工具名", "args": {参数}}]}

可用工具：
${toolDescriptions}

规则：
- 如果需要调用工具，JSON 必须在回复的最开头，独占一行
- 工具调用后不需要输出其他文字，等待工具结果返回后再回复用户
- 如果不需要工具，直接正常回复用户
- 不要在回复中间或末尾输出工具调用 JSON`.trim();
}

interface ParsedToolCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Parse tool calls from the model's text output.
 * Looks for a JSON block at the start of the text.
 *
 * @returns { toolCalls, remainingText } — remainingText is the non-tool part
 */
export function parseToolCallsFromText(text: string): {
  toolCalls: ParsedToolCall[];
  remainingText: string;
} {
  const trimmed = text.trim();

  // Try to find a JSON object at the start
  const jsonMatch = trimmed.match(/^\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { toolCalls: [], remainingText: text };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
      const toolCalls: ParsedToolCall[] = parsed.tool_calls
        .filter((tc: unknown) => {
          const call = tc as Record<string, unknown>;
          return call.name && typeof call.name === "string";
        })
        .map((tc: unknown) => {
          const call = tc as Record<string, unknown>;
          return {
            name: call.name as string,
            args: (call.args as Record<string, unknown>) ?? {},
          };
        });

      if (toolCalls.length > 0) {
        const remainingText = trimmed.slice(jsonMatch[0].length).trim();
        return { toolCalls, remainingText };
      }
    }
  } catch {
    // Not valid JSON — treat as normal text
  }

  return { toolCalls: [], remainingText: text };
}

/**
 * Run the prompt-based tool loop in streaming mode.
 *
 * 1. Add tool prompt to system messages
 * 2. Stream the model's reply
 * 3. Check if the reply contains tool calls
 * 4. If yes: execute tools, add results to messages, go back to 2
 * 5. If no: stream the reply to the user
 */
export async function* runPromptBasedToolLoop(
  provider: LLMProvider,
  tools: ToolRegistry,
  messages: ChatMessage[],
  context?: ToolContext,
): AsyncGenerator<StreamChunk, void, unknown> {
  // Build the tool prompt and append to the system message
  const toolDefs = tools.getDefinitions();
  const toolPrompt = buildToolPrompt(toolDefs);

  // Modify the system message to include tool instructions
  const modifiedMessages: ChatMessage[] = messages.map((msg, i) => {
    if (i === 0 && msg.role === "system") {
      return { ...msg, content: `${msg.content}\n\n${toolPrompt}` };
    }
    return msg;
  });

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // Stream the model's reply
    let fullReply = "";

    // For the first iteration, we need to check for tool calls.
    // We can't stream AND check for tool calls at the same time reliably,
    // so we collect the full reply first, then decide.
    if (iteration === 0 || messages.length > 2) {
      // Use non-streaming chat to get the full reply for tool call detection
      const response = await provider.chat(modifiedMessages);
      fullReply = response.content;

      // Check for tool calls
      const { toolCalls, remainingText } = parseToolCallsFromText(fullReply);

      if (toolCalls.length > 0) {
        // Execute tools
        yield {
          type: "tool_calls",
          tool_calls: toolCalls.map((tc) => ({
            id: `prompt_tc_${iteration}_${tc.name}`,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args),
            },
          })),
        };

        // Add assistant reply to messages
        modifiedMessages.push({
          role: "assistant",
          content: fullReply,
        });

        // Execute and add tool results
        const fakeToolCalls = toolCalls.map((tc) => ({
          id: `prompt_tc_${iteration}_${tc.name}`,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args),
          },
        }));

        const results = await tools.executeAll(fakeToolCalls, context);

        for (const tc of fakeToolCalls) {
          const result = results.get(tc.id) ?? '{"error": "No result"}';
          const truncated =
            result.length > MAX_TOOL_RESULT_LENGTH
              ? result.slice(0, MAX_TOOL_RESULT_LENGTH) + "\n...(结果已截断)"
              : result;

          modifiedMessages.push({
            role: "tool",
            content: truncated,
            tool_call_id: tc.id,
            name: tc.function.name,
          });
        }

        // Loop back — the model will see tool results and produce a final reply
        continue;
      }

      // No tool calls — stream the reply to the user
      // Since we already have the full text, yield it as a single token
      // (re-streaming would cost another LLM call)
      if (remainingText) {
        yield { type: "token", content: remainingText };
      }
      yield { type: "done", finish_reason: "stop" };
      return;
    }

    // Fallback: should not reach here, but just in case
    break;
  }

  // Exhausted iterations — stream a final reply without tools
  yield* provider.streamFinalReply(modifiedMessages);
}

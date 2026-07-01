/**
 * Core type definitions for the LLM provider layer.
 *
 * The types here are consumed by every graph and route, so they must stay
 * framework-agnostic — no LangChain-specific imports leak through.
 */

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * A single message in a conversation.
 *
 * `tool` role messages carry the *result* of a tool call back to the model so
 * it can reason about the returned data.  `assistant` messages may carry
 * `tool_calls` when the model decides to invoke a tool instead of (or in
 * addition to) producing a text reply.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Present only on assistant messages that request tool execution. */
  tool_calls?: ToolCall[];
  /** Present only on tool-role messages — links the result to its call. */
  tool_call_id?: string;
  /** Human-readable name of the tool (for tool-role messages). */
  name?: string;
}

// ---------------------------------------------------------------------------
// Tool calling
// ---------------------------------------------------------------------------

/**
 * A tool definition expressed in the OpenAI function-calling JSON Schema
 * format.  This is what gets passed to `LLMProvider.chatWithTools()`.
 */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

/**
 * A tool call requested by the model.
 * The agent loop executes the named tool with the given arguments and feeds
 * the result back as a `tool`-role message.
 */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // raw JSON string from the model
  };
}

/**
 * A function that the agent loop can call when the model requests it.
 *
 * The handler receives the parsed JSON arguments and a context object that
 * may contain user/session metadata.  It returns a string that will be sent
 * back to the model as a tool-result message.
 */
export type ToolHandler = (args: Record<string, unknown>, context?: ToolContext) => Promise<string>;

/**
 * Context passed to tool handlers.  This is how the Agent route gives tools
 * access to session-scoped data (user ID, session ID, etc.) without each tool
 * needing to parse HTTP requests.
 */
export interface ToolContext {
  userId?: string;
  sessionId?: string;
  /** Additional context-specific data set by the caller. */
  metadata?: Record<string, unknown>;
}

/**
 * A tool that has been registered with the agent — definition + handler.
 */
export interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

// ---------------------------------------------------------------------------
// LLM responses
// ---------------------------------------------------------------------------

export interface LLMResponse {
  content: string;
  /** Present when the model wants to call tools instead of (or before)
   *  producing a final text reply. */
  tool_calls?: ToolCall[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  /** Finish reason from the model: "stop" | "tool_calls" | "length". */
  finish_reason?: string;
}

// ---------------------------------------------------------------------------
// Streaming chunks (for streamWithTools)
// ---------------------------------------------------------------------------

/**
 * A chunk emitted by `streamWithTools`. The agent loop consumes these to
 * drive the two-phase streaming experience:
 *
 * - `tool_calls`: the model wants to call tools. The loop executes them,
 *   appends results to messages, and calls `streamWithTools` again.
 * - `token`: a text token from the final reply. Forwarded to the SSE client.
 * - `done`: the model finished. Contains the finish reason.
 */
export type StreamChunk =
  | { type: "token"; content: string }
  | { type: "tool_calls"; tool_calls: ToolCall[] }
  | { type: "done"; finish_reason: string };

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

/**
 * Error thrown when the model doesn't support native function calling.
 * The agent loop catches this and falls back to prompt-based tool calling.
 */
export class ToolCallingNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolCallingNotSupportedError";
  }
}

/**
 * Check if an error indicates the model doesn't support function calling.
 */
export function isToolCallingError(err: unknown): boolean {
  if (err instanceof ToolCallingNotSupportedError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    lower.includes("does not support function calling") ||
    (lower.includes("tool_calls") && lower.includes("not supported")) ||
    lower.includes("unrecognized request argument") ||
    (lower.includes("functions") && lower.includes("not supported")) ||
    (lower.includes("invalid_request_error") && lower.includes("tools"))
  );
}

export interface LLMProvider {
  /** Plain text chat — no tool calling. Returns a complete response. */
  chat(messages: ChatMessage[]): Promise<LLMResponse>;

  /** Streaming chat — yields text tokens. Does not support tool calls. */
  stream(messages: ChatMessage[]): AsyncGenerator<string, void, unknown>;

  /**
   * Chat with tools available. The model may choose to call one or more tools
   * (returned in `LLMResponse.tool_calls`) or produce a normal text reply.
   *
   * The caller (agent loop) is responsible for executing tool calls and
   * feeding results back via subsequent `chatWithTools` calls with
   * `tool`-role messages.
   */
  chatWithTools(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse>;

  /**
   * Two-phase streaming with tool support.
   *
   * Phase 1: non-streaming `chatWithTools` to decide if tools are needed.
   *   - If tool_calls: yield `{ type: "tool_calls" }` and return.
   *     The caller executes tools, appends results, and calls again.
   *   - If no tool_calls: yield `{ type: "token" }` with the full content
   *     (saves a second LLM call) then `{ type: "done" }`.
   *
   * For the final reply AFTER tool execution, use `streamFinalReply` instead
   * to get real token-by-token streaming.
   */
  streamWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
  ): AsyncGenerator<StreamChunk, void, unknown>;

  /**
   * Pure streaming output — used after tool execution to stream the model's
   * final reply token by token. No tool calling support.
   */
  streamFinalReply(messages: ChatMessage[]): AsyncGenerator<StreamChunk, void, unknown>;
}

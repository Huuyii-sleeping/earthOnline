import { ChatOpenAI } from "@langchain/openai";
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type {
  ChatMessage,
  LLMProvider,
  LLMResponse,
  ToolDefinition,
  ToolCall,
  StreamChunk,
} from "./types.js";

/**
 * Convert our framework-agnostic ChatMessage[] into LangChain message objects.
 *
 * Tool-role messages become ToolMessage so LangChain can correlate them with
 * the originating tool call via `tool_call_id`.
 */
function toLangChainMessages(messages: ChatMessage[]): BaseMessage[] {
  return messages.map((msg) => {
    switch (msg.role) {
      case "system":
        return new SystemMessage(msg.content);
      case "user":
        return new HumanMessage(msg.content);
      case "assistant": {
        // If the assistant message carries tool_calls, include them so the
        // model sees the full conversation history including its own tool
        // requests.
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          return new AIMessage({
            content: msg.content,
            tool_calls: msg.tool_calls.map((tc) => ({
              id: tc.id,
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments || "{}"),
            })),
          });
        }
        return new AIMessage(msg.content);
      }
      case "tool":
        return new ToolMessage({
          content: msg.content,
          tool_call_id: msg.tool_call_id ?? "",
          name: msg.name,
        });
      default:
        return new HumanMessage(msg.content);
    }
  });
}

/**
 * Convert LangChain's structured tool-calling format into our flat ToolCall[]
 * type. LangChain's AIMessage.tool_calls is an array of objects with shape
 * { id, name, args }, which we normalize to { id, type, function: { name, arguments } }.
 */
function extractToolCalls(message: AIMessage): ToolCall[] | undefined {
  const rawCalls = message.tool_calls;
  if (!rawCalls || rawCalls.length === 0) return undefined;

  return rawCalls.map((tc) => ({
    id: tc.id ?? "",
    type: "function" as const,
    function: {
      name: tc.name ?? "",
      arguments: JSON.stringify(tc.args ?? {}),
    },
  }));
}

export class OpenAIProvider implements LLMProvider {
  private model: ChatOpenAI;
  private savedApiKey: string;
  private savedModelName: string;
  private savedApiBase?: string;

  constructor(apiKey: string, modelName = "gpt-4o", apiBase?: string) {
    const config: ConstructorParameters<typeof ChatOpenAI>[0] = {
      openAIApiKey: apiKey,
      modelName,
      temperature: 0.8,
      streaming: false,
    };
    if (apiBase) {
      config.configuration = { baseURL: apiBase };
    }
    this.model = new ChatOpenAI(config);
    this.savedApiKey = apiKey;
    this.savedModelName = modelName;
    this.savedApiBase = apiBase;
  }

  /**
   * Build a private config object for creating new ChatOpenAI instances.
   * Avoids duplicating the apiBase check across methods.
   */
  private buildConfig(
    overrides: Partial<ConstructorParameters<typeof ChatOpenAI>[0]> = {},
  ): ConstructorParameters<typeof ChatOpenAI>[0] {
    const config: ConstructorParameters<typeof ChatOpenAI>[0] = {
      openAIApiKey: this.savedApiKey,
      modelName: this.savedModelName,
      temperature: 0.8,
      ...overrides,
    };
    if (this.savedApiBase) {
      config!.configuration = { baseURL: this.savedApiBase };
    }
    return config;
  }

  async chat(messages: ChatMessage[]): Promise<LLMResponse> {
    // Always use streaming internally — some OpenAI-compatible APIs (Zhipu,
    // DashScope) hang on non-streaming invoke. Streaming is reliable.
    let content = "";
    for await (const token of this.stream(messages)) {
      content += token;
    }
    return { content };
  }

  async *stream(messages: ChatMessage[]): AsyncGenerator<string, void, unknown> {
    const lcMessages = toLangChainMessages(messages);
    const streamingModel = new ChatOpenAI(this.buildConfig({ streaming: true, timeout: 90000 }));

    try {
      const stream = await streamingModel.stream(lcMessages);
      for await (const chunk of stream) {
        const text = chunk.content.toString();
        if (text) {
          yield text;
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (errorMsg.includes("Premature close") || errorMsg.includes("ERR_STREAM_PREMATURE_CLOSE")) {
        return;
      }
      throw err;
    }
  }

  /**
   * Chat with tool-calling support.
   *
   * Uses LangChain's `.bindTools()` to attach tool definitions, then invokes
   * the model. If the model decides to call tools, the response will contain
   * `tool_calls` — the agent loop is responsible for executing them and
   * feeding results back.
   *
   * This method uses non-streaming invoke because:
   * 1. Tool calls need the complete structured response, not token-by-token.
   * 2. Most OpenAI-compatible APIs handle tool calls via non-streaming fine
   *    (the "Premature close" issue primarily affects plain text completion).
   * 3. If invoke does fail, we fall back to streaming and skip tool support.
   */
  async chatWithTools(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    const lcMessages = toLangChainMessages(messages);

    // Convert our ToolDefinition[] to LangChain's format.
    const lcTools = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      },
    }));

    const model = new ChatOpenAI(this.buildConfig({ streaming: false }));

    try {
      const boundModel = model.bindTools(lcTools);
      const result = (await boundModel.invoke(lcMessages)) as AIMessage;

      const toolCalls = extractToolCalls(result);

      return {
        content: result.content.toString(),
        tool_calls: toolCalls,
        finish_reason: toolCalls ? "tool_calls" : "stop",
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Fallback: if invoke fails (e.g. Premature close on some APIs),
      // stream the response without tool support. The agent loop will get
      // a plain text response and treat it as a normal reply.
      if (errorMsg.includes("Premature close") || errorMsg.includes("ERR_STREAM_PREMATURE_CLOSE")) {
        let content = "";
        for await (const token of this.stream(messages)) {
          content += token;
        }
        return { content, finish_reason: "stop" };
      }

      throw err;
    }
  }

  /**
   * Two-phase streaming with tool support.
   *
   * Phase 1: non-streaming chatWithTools to decide if tools are needed.
   *   - If tool_calls: yield tool_calls chunk and return.
   *   - If no tool_calls: yield the content as a single token chunk
   *     (saves a second LLM call), then yield done.
   *
   * The caller (agent loop) handles tool execution and calls streamFinalReply
   * for the real token-by-token streaming of the final reply.
   */
  async *streamWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const result = await this.chatWithTools(messages, tools);

    if (result.tool_calls && result.tool_calls.length > 0) {
      yield { type: "tool_calls", tool_calls: result.tool_calls };
      return;
    }

    // No tool calls — yield the content directly. No need for a second
    // streaming call; we already have the full response.
    if (result.content) {
      yield { type: "token", content: result.content };
    }
    yield { type: "done", finish_reason: result.finish_reason ?? "stop" };
  }

  /**
   * Pure streaming output for the final reply after tool execution.
   * Streams token by token, wrapping each in a StreamChunk.
   */
  async *streamFinalReply(messages: ChatMessage[]): AsyncGenerator<StreamChunk, void, unknown> {
    for await (const token of this.stream(messages)) {
      yield { type: "token", content: token };
    }
    yield { type: "done", finish_reason: "stop" };
  }
}

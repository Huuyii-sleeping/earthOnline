import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import type { ChatMessage, LLMProvider, LLMResponse } from "./types.js";

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
      // Do NOT set streaming: true globally — it causes "Premature close"
      // errors with some OpenAI-compatible APIs (e.g. Aliyun DashScope).
      // Streaming is handled per-call via the stream() method instead.
      streaming: false,
    };
    // Allow custom API base URL (e.g. OpenAI-compatible proxies)
    if (apiBase) {
      config.configuration = { baseURL: apiBase };
    }
    this.model = new ChatOpenAI(config);
    this.savedApiKey = apiKey;
    this.savedModelName = modelName;
    this.savedApiBase = apiBase;
  }

  private toLangChainMessages(messages: ChatMessage[]) {
    return messages.map((msg) => {
      switch (msg.role) {
        case "system":
          return new SystemMessage(msg.content);
        case "user":
          return new HumanMessage(msg.content);
        case "assistant":
          return new AIMessage(msg.content);
        default:
          return new HumanMessage(msg.content);
      }
    });
  }

  async chat(messages: ChatMessage[]): Promise<LLMResponse> {
    // Always use streaming internally, even for non-streaming callers.
    // Some OpenAI-compatible APIs (e.g. Zhipu/GLM, Aliyun DashScope) are
    // unreliable with non-streaming invoke — they either return "Premature
    // close" or hang indefinitely. Streaming mode is consistently reliable
    // with these APIs, so we collect all tokens and return the full string.
    let content = "";
    for await (const token of this.stream(messages)) {
      content += token;
    }
    return { content };
  }

  async *stream(messages: ChatMessage[]): AsyncGenerator<string, void, unknown> {
    // Create a streaming-enabled instance for this call only.
    const lcMessages = this.toLangChainMessages(messages);
    const streamConfig: ConstructorParameters<typeof ChatOpenAI>[0] = {
      openAIApiKey: this.savedApiKey,
      modelName: this.savedModelName,
      temperature: 0.8,
      streaming: true,
      timeout: 90000, // 90s timeout for the initial HTTP response
    };
    if (this.savedApiBase) {
      streamConfig!.configuration = { baseURL: this.savedApiBase };
    }
    const streamingModel = new ChatOpenAI(streamConfig);

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
      // Some OpenAI-compatible APIs close the SSE connection in a way that
      // triggers "Premature close" / ERR_STREAM_PREMATURE_CLOSE after all
      // tokens have been received. Safe to ignore.
      if (errorMsg.includes("Premature close") || errorMsg.includes("ERR_STREAM_PREMATURE_CLOSE")) {
        return;
      }
      throw err;
    }
  }
}

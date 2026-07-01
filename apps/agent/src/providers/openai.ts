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
    const lcMessages = this.toLangChainMessages(messages);
    const result = await this.model.invoke(lcMessages);
    return {
      content: result.content.toString(),
    };
  }

  async *stream(messages: ChatMessage[]): AsyncGenerator<string, void, unknown> {
    // Create a streaming-enabled instance for this call only.
    // We can't reuse the main model because it has streaming: false.
    const lcMessages = this.toLangChainMessages(messages);
    const streamConfig: ConstructorParameters<typeof ChatOpenAI>[0] = {
      openAIApiKey: this.savedApiKey,
      modelName: this.savedModelName,
      temperature: 0.8,
      streaming: true,
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
      // Some OpenAI-compatible APIs (e.g. Aliyun DashScope) close the SSE
      // connection in a way that triggers "Premature close" / ERR_STREAM_PREMATURE_CLOSE
      // in node-fetch after all tokens have been received. Since we've already
      // yielded all tokens, we can safely ignore this error.
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (errorMsg.includes("Premature close") || errorMsg.includes("ERR_STREAM_PREMATURE_CLOSE")) {
        // Tokens already yielded; just end the generator gracefully.
        return;
      }
      throw err;
    }
  }
}

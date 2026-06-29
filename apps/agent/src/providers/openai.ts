import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import type { ChatMessage, LLMProvider, LLMResponse } from "./types.js";

export class OpenAIProvider implements LLMProvider {
  private model: ChatOpenAI;

  constructor(apiKey: string, modelName = "gpt-4o") {
    this.model = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName,
      temperature: 0.8,
      streaming: true,
    });
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
    const lcMessages = this.toLangChainMessages(messages);
    const stream = await this.model.stream(lcMessages);
    for await (const chunk of stream) {
      const text = chunk.content.toString();
      if (text) {
        yield text;
      }
    }
  }
}

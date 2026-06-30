export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface LLMProvider {
  chat(messages: ChatMessage[]): Promise<LLMResponse>;
  stream(messages: ChatMessage[]): AsyncGenerator<string, void, unknown>;
}

import { env } from "../server/env.js";
import { OpenAIProvider } from "./openai.js";
import type { LLMProvider } from "./types.js";

let providerInstance: LLMProvider | null = null;

export function getLLMProvider(): LLMProvider {
  if (providerInstance) return providerInstance;

  if (env.OPENAI_API_KEY) {
    providerInstance = new OpenAIProvider(env.OPENAI_API_KEY);
    return providerInstance;
  }

  throw new Error("No LLM provider configured. Set OPENAI_API_KEY environment variable.");
}

// AgentRuntimeConfig is sent by the Go API on behalf of the frontend.
export interface AgentRuntimeConfig {
  api_url: string;
  api_key: string;
  model: string;
  system_prompt?: string;
}

// getLLMProviderFromRuntime creates a provider using browser-supplied credentials.
// Falls back to the server-side provider when runtime is not provided.
export function getLLMProviderFromRuntime(runtime?: AgentRuntimeConfig | null): LLMProvider {
  if (runtime?.api_key) {
    return new OpenAIProvider(
      runtime.api_key,
      runtime.model || "gpt-4o-mini",
      runtime.api_url || undefined,
    );
  }
  return getLLMProvider();
}

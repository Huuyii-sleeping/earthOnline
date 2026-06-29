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

  throw new Error(
    "No LLM provider configured. Set OPENAI_API_KEY environment variable.",
  );
}

/**
 * Token estimation utilities for context window management.
 *
 * We don't use tiktoken (requires WASM, adds heavy dependency). Instead we
 * approximate: Chinese 1 char ≈ 1.5 tokens, English 1 word ≈ 1.3 tokens.
 * The ±20% error is fine — we only need to know "should we compress?",
 * not the exact token count.
 */

import type { ChatMessage } from "../providers/types.js";

/**
 * Estimate the token count of a raw string.
 * Chinese characters are counted as 1.5 tokens each, ASCII words as 1.3.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  // Count Chinese characters (CJK Unified Ideographs range)
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  // Count non-CJK words (split by whitespace, count non-empty)
  const nonCjkText = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, " ");
  const words = nonCjkText.split(/\s+/).filter((w) => w.length > 0).length;

  return Math.ceil(cjkChars * 1.5 + words * 1.3);
}

/**
 * Estimate the total token count of a ChatMessage[].
 * Each message has ~4 tokens of overhead (role tags, formatting).
 */
export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += 4; // role + formatting overhead
    total += estimateTokens(msg.content);
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += estimateTokens(tc.function.name);
        total += estimateTokens(tc.function.arguments);
      }
    }
    if (msg.name) {
      total += estimateTokens(msg.name);
    }
  }
  return total;
}

/**
 * Known context window sizes for common models.
 * Falls back to 16384 for unknown models (conservative).
 */
const CONTEXT_WINDOWS: Record<string, number> = {
  // OpenAI
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4-turbo": 128000,
  "gpt-4-turbo-preview": 128000,
  "gpt-4": 8192,
  "gpt-3.5-turbo": 16385,
  // Anthropic
  "claude-3-opus": 200000,
  "claude-3-sonnet": 200000,
  "claude-3-haiku": 200000,
  "claude-3.5-sonnet": 200000,
  // Zhipu GLM
  "glm-4": 128000,
  "glm-4-plus": 128000,
  "glm-4-air": 128000,
  "glm-4-flash": 128000,
  "glm-4v": 128000,
  // Aliyun DashScope
  "qwen-max": 32000,
  "qwen-plus": 128000,
  "qwen-turbo": 128000,
  // DeepSeek
  "deepseek-chat": 64000,
  "deepseek-coder": 64000,
};

/**
 * Get the context window size for a model.
 * @param modelName - The model name (case-insensitive prefix match)
 * @returns Context window in tokens, defaults to 16384
 */
export function getContextWindowSize(modelName: string): number {
  const lower = modelName.toLowerCase();

  // Exact match first
  if (CONTEXT_WINDOWS[lower]) {
    return CONTEXT_WINDOWS[lower];
  }

  // Prefix match (handles model variants like "gpt-4o-2024-05-13")
  for (const [key, size] of Object.entries(CONTEXT_WINDOWS)) {
    if (lower.startsWith(key)) {
      return size;
    }
  }

  return 16384;
}

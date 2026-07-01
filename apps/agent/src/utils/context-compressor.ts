/**
 * Context window management — sliding window + summarization.
 *
 * When conversation history grows too large, we compress it:
 * - Keep the most recent N turns as raw messages (high fidelity)
 * - Summarize older messages into a compact text block (low fidelity)
 * - The summary is stored in the DB and passed as a system message
 *
 * Trigger: when estimated tokens exceed 40% of the model's context window.
 * This leaves 60% for system prompt, tool definitions, current message,
 * and the model's reply.
 */

import type { ChatMessage, LLMProvider } from "../providers/types.js";
import { estimateMessagesTokens, estimateTokens, getContextWindowSize } from "./tokens.js";

export interface CompressedHistory {
  /** Summary of older conversations (may be empty on first compression). */
  summary: string;
  /** Recent messages kept in full fidelity. */
  recentMessages: ChatMessage[];
  /** Estimated total tokens after compression. */
  totalTokens: number;
}

const SUMMARY_PROMPT = `请将以下对话历史压缩为一段不超过 200 字的摘要。

保留：
- 经历的核心事实（发生了什么）
- 用户表达的情绪和态度
- Agent 已经追问过的维度（避免重复追问）
- 任何用户明确表达的偏好或需求

丢弃：
- 寒暄和重复内容
- 不影响理解细节的过渡语句

${"如果有已有摘要，在其基础上增量更新，不要丢失之前摘要中的关键信息。"}`;

const MAX_SUMMARY_LENGTH = 200; // characters

export class ContextCompressor {
  private contextWindow: number;

  constructor(
    private provider: LLMProvider,
    modelName?: string,
  ) {
    this.contextWindow = modelName ? getContextWindowSize(modelName) : 16384;
  }

  /**
   * Check if the conversation history needs compression.
   * Trigger: estimated tokens > 40% of context window.
   */
  needsCompression(messages: ChatMessage[]): boolean {
    const tokens = estimateMessagesTokens(messages);
    return tokens > this.contextWindow * 0.4;
  }

  /**
   * Compress conversation history into summary + recent messages.
   *
   * Strategy:
   * 1. Reserve 30% of context window for recent messages (raw)
   * 2. Everything before that becomes the new summary
   * 3. Generate summary via LLM (old summary + old messages → new summary)
   *
   * @param messages Full conversation history (system messages excluded)
   * @param existingSummary Previous summary text if any
   */
  async compress(messages: ChatMessage[], existingSummary?: string): Promise<CompressedHistory> {
    if (messages.length === 0) {
      return { summary: existingSummary || "", recentMessages: [], totalTokens: 0 };
    }

    // Calculate how many recent messages we can keep raw.
    // Target: 30% of context window for recent messages.
    const recentTokenBudget = this.contextWindow * 0.3;
    const recentMessages: ChatMessage[] = [];
    let recentTokens = 0;

    // Walk backwards from the most recent message, adding to recentMessages
    // until we hit the token budget.
    for (let i = messages.length - 1; i >= 0; i--) {
      const msgTokens = estimateTokens(messages[i].content) + 4;
      if (recentTokens + msgTokens > recentTokenBudget && recentMessages.length >= 4) {
        // Keep at least 4 messages (2 turns) even if under budget.
        break;
      }
      recentMessages.unshift(messages[i]);
      recentTokens += msgTokens;
    }

    // Messages before the recent window get summarized.
    const messagesToSummarize = messages.slice(0, messages.length - recentMessages.length);

    if (messagesToSummarize.length === 0) {
      // Nothing to summarize — recent window covers everything.
      return {
        summary: existingSummary || "",
        recentMessages,
        totalTokens: recentTokens + estimateTokens(existingSummary || ""),
      };
    }

    // Generate the summary.
    const newSummary = await this.generateSummary(messagesToSummarize, existingSummary);

    return {
      summary: newSummary,
      recentMessages,
      totalTokens: recentTokens + estimateTokens(newSummary),
    };
  }

  /**
   * Generate a summary of older messages, incorporating any existing summary.
   */
  private async generateSummary(
    messages: ChatMessage[],
    existingSummary?: string,
  ): Promise<string> {
    // Format messages for the summarizer.
    const conversationText = messages
      .map((msg) => {
        const role = msg.role === "user" ? "用户" : msg.role === "assistant" ? "Agent" : msg.role;
        return `${role}：${msg.content}`;
      })
      .join("\n\n");

    const userContent = existingSummary
      ? `已有摘要：\n${existingSummary}\n\n---\n\n需要增量更新的对话内容：\n${conversationText}`
      : `对话内容：\n${conversationText}`;

    const summaryMessages: ChatMessage[] = [
      { role: "system", content: SUMMARY_PROMPT },
      { role: "user", content: userContent },
    ];

    try {
      const response = await this.provider.chat(summaryMessages);
      let summary = response.content.trim();

      // Enforce max length.
      if (summary.length > MAX_SUMMARY_LENGTH * 2) {
        summary = summary.slice(0, MAX_SUMMARY_LENGTH) + "...";
      }

      return summary;
    } catch {
      // If summarization fails, fall back to existing summary or a
      // truncated version of the conversation.
      if (existingSummary) return existingSummary;
      return conversationText.slice(0, MAX_SUMMARY_LENGTH) + "...";
    }
  }
}

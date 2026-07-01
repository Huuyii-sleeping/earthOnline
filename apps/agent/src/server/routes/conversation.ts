import type { FastifyInstance } from "fastify";
import {
  processConversation,
  generateConversationSummary,
} from "../../graphs/conversation.graph.js";
import {
  getLLMProvider,
  getLLMProviderFromRuntime,
  type AgentRuntimeConfig,
} from "../../providers/index.js";
import { checkSafety } from "../../safety/index.js";
import { createDefaultToolRegistry } from "../../tools/registry.js";
import type { ToolContext, ChatMessage } from "../../providers/types.js";
import { runReActLoopStream } from "../../agent/react-loop.js";
import { conversationFollowupPromptV1 } from "../../prompts/conversation-followup.v1.js";
import { ContextCompressor } from "../../utils/context-compressor.js";
import {
  buildSystemPrompt,
  transition,
  initialState,
  type StateContext,
  type ConversationState,
} from "../../agent/conversation-state.js";

interface SendMessageBody {
  session_id: string;
  content: string;
  context?: Record<string, unknown>;
  history?: { role: "user" | "assistant"; content: string }[];
  agent_runtime?: AgentRuntimeConfig | null;
  /** User ID for tool context — passed by the Go API. */
  user_id?: string;
  /** Compressed conversation summary (for context window management). */
  summary_text?: string;
  /** Current conversation state machine phase. */
  conversation_state?: string;
}

// Compress endpoint request body
interface CompressBody {
  history?: { role: "user" | "assistant"; content: string }[];
  existing_summary?: string;
  agent_runtime?: AgentRuntimeConfig | null;
}

export async function conversationRoutes(app: FastifyInstance) {
  // Create a shared tool registry instance.
  const toolRegistry = createDefaultToolRegistry();

  // Helper: build tool context from request body.
  function buildToolContext(body: SendMessageBody): ToolContext | undefined {
    if (!body.user_id) return undefined;
    return {
      userId: body.user_id,
      sessionId: body.session_id,
    };
  }

  // Helper: write SSE data line.
  function writeSSE(raw: NodeJS.WritableStream, data: unknown) {
    raw.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  // Non-streaming: send a message and get a reply
  app.post("/sessions/:sessionId/messages", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = request.body as SendMessageBody;

    if (!body?.content) {
      return reply.code(400).send({ error: "content is required" });
    }

    const history = body.history || [];
    const toolContext = buildToolContext(body);

    // Safety review before processing
    const safety = checkSafety(body.content);
    if (!safety.safe) {
      request.log.warn({ reason: safety.reason }, "safety check triggered");
      return {
        reply: safety.safeResponse,
        done: false,
        session_id: sessionId,
        safety_triggered: true,
      };
    }

    try {
      // Build state context from request (validate conversation_state)
      const validStates: ConversationState[] = [
        "INTAKE",
        "PROBE",
        "REFLECT",
        "READY",
        "GENERATING",
      ];
      const stateContext: StateContext =
        body.conversation_state &&
        validStates.includes(body.conversation_state as ConversationState)
          ? { ...initialState(), state: body.conversation_state as ConversationState }
          : initialState();

      const basePrompt = body.agent_runtime?.system_prompt || conversationFollowupPromptV1.template;
      const systemPrompt = buildSystemPrompt(basePrompt, stateContext);

      const result = await processConversation(
        history,
        body.content,
        body.agent_runtime,
        toolRegistry,
        toolContext,
        body.summary_text,
        systemPrompt,
      );

      // Compute the next conversation state
      const nextState = transition(stateContext, body.content, result.reply);

      return {
        reply: result.reply,
        done: result.done,
        session_id: sessionId,
        conversation_state: nextState.state,
        turn_count: nextState.turnCount,
        probe_count: nextState.probeCount,
        collected_dimensions: nextState.collectedDimensions,
      };
    } catch (error) {
      request.log.error(error, "conversation failed");
      return reply.code(500).send({
        error: "conversation processing failed",
        reply: "抱歉，我暂时无法回复，请稍后再试。",
        done: false,
      });
    }
  });

  // Streaming: send a message and stream the reply with two-phase tool support
  app.post("/sessions/:sessionId/messages/stream", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = request.body as SendMessageBody;

    if (!body?.content) {
      return reply.code(400).send({ error: "content is required" });
    }

    const history = body.history || [];
    const toolContext = buildToolContext(body);

    // Safety check
    const safety = checkSafety(body.content);
    if (!safety.safe) {
      request.log.warn({ reason: safety.reason }, "safety check triggered");
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      writeSSE(reply.raw, { token: safety.safeResponse });
      writeSSE(reply.raw, { done: true, reply: safety.safeResponse });
      reply.raw.end();
      return;
    }

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });

    try {
      // Build state context from request
      const stateContext: StateContext = body.conversation_state
        ? { ...initialState(), state: body.conversation_state as ConversationState }
        : initialState();

      const basePrompt = body.agent_runtime?.system_prompt || conversationFollowupPromptV1.template;
      const systemPrompt = buildSystemPrompt(basePrompt, stateContext);
      const provider = getLLMProviderFromRuntime(body.agent_runtime);

      let fullReply = "";
      let hadToolCalls = false;
      let clientDisconnected = false;

      // Detect client disconnect via the RESPONSE stream (reply.raw),
      // NOT request.raw — the request "close" event fires as soon as the
      // POST body is fully read, which is almost immediate.
      reply.raw.on("close", () => {
        if (!reply.raw.writableEnded) {
          clientDisconnected = true;
        }
      });

      for await (const chunk of runReActLoopStream(
        provider,
        toolRegistry,
        systemPrompt,
        history,
        body.content,
        toolContext,
        body.summary_text,
      )) {
        // Stop if client disconnected
        if (clientDisconnected) {
          request.log.info("client disconnected, aborting ReAct loop");
          break;
        }

        switch (chunk.type) {
          case "tool_calls":
            hadToolCalls = true;
            writeSSE(reply.raw, { thinking: true });
            break;
          case "token":
            fullReply += chunk.content;
            writeSSE(reply.raw, { token: chunk.content });
            break;
          case "done":
            // Compute the next conversation state
            const nextState = transition(stateContext, body.content, fullReply);
            writeSSE(reply.raw, {
              done: true,
              reply: fullReply,
              session_id: sessionId,
              used_tools: hadToolCalls,
              finish_reason: chunk.finish_reason,
              conversation_state: nextState.state,
              turn_count: nextState.turnCount,
              probe_count: nextState.probeCount,
              collected_dimensions: nextState.collectedDimensions,
            });
            break;
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error("[streaming] conversation failed:", errMsg);

      // Send a user-friendly error message via SSE so the frontend can
      // display it instead of spinning forever.
      let userFacingError = "对话服务暂时不可用，请稍后再试。";
      if (
        errMsg.includes("401") ||
        errMsg.includes("AuthenticationError") ||
        errMsg.includes("令牌已过期")
      ) {
        userFacingError = "API Key 无效或已过期，请在 Agent 设置页检查配置。";
      } else if (errMsg.includes("429") || errMsg.includes("RateError")) {
        userFacingError = "请求过于频繁，请稍后再试。";
      } else if (errMsg.includes("No LLM provider configured")) {
        userFacingError = "未配置 API Key，请先在 Agent 设置页配置。";
      }

      writeSSE(reply.raw, { error: userFacingError, done: true });
    }

    reply.raw.end();
  });

  // Generate pre-generation summary
  app.post("/sessions/:sessionId/summary", async (request, reply) => {
    const body = request.body as {
      history?: { role: "user" | "assistant"; content: string }[];
      agent_runtime?: AgentRuntimeConfig | null;
    };

    const history = body?.history || [];

    try {
      const summary = await generateConversationSummary(history, body.agent_runtime);
      return summary;
    } catch (error) {
      request.log.error(error, "summary generation failed");
      return reply.code(500).send({
        error: "summary generation failed",
        experienceSummary: "无法生成总结",
        keyMoments: [],
        detectedEmotions: [],
        possibleMeaning: "",
        readyToGenerate: false,
      });
    }
  });

  // SSE streaming endpoint (demo)
  app.get("/sessions/:sessionId/stream", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });

    reply.raw.write(`event: ready\ndata: ${JSON.stringify({ sessionId })}\n\n`);

    try {
      const provider = getLLMProvider();

      const messages = [
        { role: "system" as const, content: "你是经历成就官的 Agent。正在准备与用户对话。" },
        { role: "user" as const, content: "你好" },
      ];

      for await (const token of provider.stream(messages)) {
        reply.raw.write(`event: token\ndata: ${JSON.stringify({ content: token })}\n\n`);
      }

      reply.raw.write(`event: done\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    } catch (error) {
      request.log.error(error, "stream failed");
      const fallbackText = "Agent 服务正在启动中，请稍后再试。";
      for (const char of fallbackText) {
        reply.raw.write(`event: token\ndata: ${JSON.stringify({ content: char })}\n\n`);
      }
      reply.raw.write(`event: done\ndata: ${JSON.stringify({ ok: false })}\n\n`);
    }

    reply.raw.end();
  });

  // Compress conversation history — called by Go API when token count is high
  app.post("/sessions/:sessionId/compress", async (request, reply) => {
    const body = request.body as CompressBody;

    if (!body?.history || body.history.length === 0) {
      return { summary: body.existing_summary || "" };
    }

    try {
      const provider = getLLMProviderFromRuntime(body.agent_runtime);
      const modelName = body.agent_runtime?.model;
      const compressor = new ContextCompressor(provider, modelName);

      // Convert history to ChatMessage format for the compressor
      const messages: ChatMessage[] = body.history.map((h) => ({
        role: h.role === "user" ? ("user" as const) : ("assistant" as const),
        content: h.content,
      }));

      const compressed = await compressor.compress(messages, body.existing_summary);

      return { summary: compressed.summary };
    } catch (error) {
      request.log.error(error, "compression failed");
      return reply.code(500).send({
        error: "compression failed",
        summary: body.existing_summary || "",
        compression_failed: true,
      });
    }
  });
}

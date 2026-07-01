import type { FastifyInstance } from "fastify";
import {
  processConversation,
  streamConversation,
  generateConversationSummary,
} from "../../graphs/conversation.graph.js";
import { getLLMProvider, type AgentRuntimeConfig } from "../../providers/index.js";
import { checkSafety } from "../../safety/index.js";
import { createDefaultToolRegistry } from "../../tools/registry.js";
import type { ToolContext } from "../../providers/types.js";

interface SendMessageBody {
  session_id: string;
  content: string;
  context?: Record<string, unknown>;
  history?: { role: "user" | "assistant"; content: string }[];
  agent_runtime?: AgentRuntimeConfig | null;
  /** User ID for tool context — passed by the Go API. */
  user_id?: string;
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
      const result = await processConversation(
        history,
        body.content,
        body.agent_runtime,
        toolRegistry,
        toolContext,
      );
      return {
        reply: result.reply,
        done: result.done,
        session_id: sessionId,
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

  // Streaming: send a message and stream the reply token by token via SSE
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
      reply.raw.write(`data: ${JSON.stringify({ token: safety.safeResponse })}\n\n`);
      reply.raw.write(`data: ${JSON.stringify({ done: true, reply: safety.safeResponse })}\n\n`);
      reply.raw.end();
      return;
    }

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });

    try {
      let fullReply = "";
      for await (const token of streamConversation(
        history,
        body.content,
        body.agent_runtime,
        toolRegistry,
        toolContext,
      )) {
        fullReply += token;
        reply.raw.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
      reply.raw.write(
        `data: ${JSON.stringify({ done: true, reply: fullReply, session_id: sessionId })}\n\n`,
      );
    } catch (error) {
      request.log.error(error, "streaming conversation failed");
      reply.raw.write(
        `data: ${JSON.stringify({ error: "conversation streaming failed", done: true })}\n\n`,
      );
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
}

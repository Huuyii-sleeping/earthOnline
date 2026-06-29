import type { FastifyInstance } from "fastify";
import { processConversation, generateConversationSummary } from "../../graphs/conversation.graph.js";
import { getLLMProvider } from "../../providers/index.js";
import { checkSafety } from "../../safety/index.js";

interface SendMessageBody {
  session_id: string;
  content: string;
  context?: Record<string, unknown>;
  history?: { role: "user" | "assistant"; content: string }[];
}

export async function conversationRoutes(app: FastifyInstance) {
  // Non-streaming: send a message and get a reply
  app.post("/sessions/:sessionId/messages", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = request.body as SendMessageBody;

    if (!body?.content) {
      return reply.code(400).send({ error: "content is required" });
    }

    const history = body.history || [];

    try {
      const result = await processConversation(history, body.content);
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

  // Generate pre-generation summary
  app.post("/sessions/:sessionId/summary", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = request.body as { history?: { role: "user" | "assistant"; content: string }[] };

    const history = body?.history || [];

    try {
      const summary = await generateConversationSummary(history);
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

  // SSE streaming endpoint
  app.get("/sessions/:sessionId/stream", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });

    reply.raw.write(`event: ready\ndata: ${JSON.stringify({ sessionId })}\n\n`);

    // Try to stream from LLM
    try {
      const provider = getLLMProvider();

      // Build a simple context for streaming demo
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
      // Fallback: send mock tokens
      const fallbackText = "Agent 服务正在启动中，请稍后再试。";
      for (const char of fallbackText) {
        reply.raw.write(`event: token\ndata: ${JSON.stringify({ content: char })}\n\n`);
      }
      reply.raw.write(`event: done\ndata: ${JSON.stringify({ ok: false })}\n\n`);
    }

    reply.raw.end();
  });
}

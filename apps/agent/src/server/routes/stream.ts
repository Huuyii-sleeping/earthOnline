import type { FastifyInstance } from "fastify";

export async function streamRoutes(app: FastifyInstance) {
  app.get("/sessions/:sessionId/stream", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });

    reply.raw.write(`event: ready\ndata: ${JSON.stringify({ sessionId })}\n\n`);
    reply.raw.write(
      `event: token\ndata: ${JSON.stringify({ content: "Agent service is ready." })}\n\n`,
    );
    reply.raw.write(`event: done\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    reply.raw.end();
  });
}

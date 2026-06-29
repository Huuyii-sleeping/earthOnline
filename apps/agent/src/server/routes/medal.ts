import type { FastifyInstance } from "fastify";
import { generateMedal, regenerateMedalMeaning, type MedalHistoryItem } from "../../graphs/experience-medal.graph.js";

interface GenerateMedalBody {
  session_id?: string;
  experience?: string;
  history?: MedalHistoryItem[];
  direction?: string;
  user_input?: string;
}

export async function medalRoutes(app: FastifyInstance) {
  // Generate a medal from conversation history
  app.post("/medals/generate", async (request, reply) => {
    const body = request.body as GenerateMedalBody;

    if (!body?.history || body.history.length === 0) {
      return reply.code(400).send({ error: "history is required" });
    }

    try {
      const result = await generateMedal(body.history, body.experience);
      return result;
    } catch (error) {
      request.log.error(error, "medal generation failed");
      return reply.code(500).send({
        error: "medal generation failed",
        detail: error instanceof Error ? error.message : "unknown error",
      });
    }
  });

  // Regenerate meaning focus of a medal
  app.post("/medals/regenerate-meaning", async (request, reply) => {
    const body = request.body as GenerateMedalBody;

    if (!body?.history || body.history.length === 0) {
      return reply.code(400).send({ error: "history is required" });
    }

    try {
      const result = await regenerateMedalMeaning(
        body.history,
        body.direction,
        body.user_input,
        body.experience,
      );
      return result;
    } catch (error) {
      request.log.error(error, "meaning regeneration failed");
      return reply.code(500).send({
        error: "meaning regeneration failed",
        detail: error instanceof Error ? error.message : "unknown error",
      });
    }
  });
}
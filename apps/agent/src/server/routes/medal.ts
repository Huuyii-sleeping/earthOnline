import type { FastifyInstance } from "fastify";
import {
  generateMedal,
  regenerateMedalMeaning,
  type MedalHistoryItem,
} from "../../graphs/experience-medal.graph.js";
import { generateVisualInstructions } from "../../graphs/medal-visual.graph.js";
import type { AgentRuntimeConfig } from "../../providers/index.js";

interface GenerateMedalBody {
  session_id?: string;
  experience?: string;
  history?: MedalHistoryItem[];
  direction?: string;
  user_input?: string;
  agent_runtime?: AgentRuntimeConfig | null;
}

interface GenerateVisualBody {
  medal_title?: string;
  short_reason?: string;
  meaning_focus?: string;
  story?: string;
}

export async function medalRoutes(app: FastifyInstance) {
  // Generate a medal from conversation history
  app.post("/medals/generate", async (request, reply) => {
    const body = request.body as GenerateMedalBody;

    if (!body?.history || body.history.length === 0) {
      return reply.code(400).send({ error: "history is required" });
    }

    try {
      const result = await generateMedal(body.history, body.experience, body.agent_runtime);
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
        body.agent_runtime,
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

  // Generate visual instructions for a medal
  app.post("/medals/generate-visual", async (request, reply) => {
    const body = request.body as GenerateVisualBody;

    if (!body?.medal_title || !body.medal_title.trim()) {
      return reply.code(400).send({ error: "medal_title is required" });
    }
    if (!body?.short_reason || !body.short_reason.trim()) {
      return reply.code(400).send({ error: "short_reason is required" });
    }

    try {
      const result = await generateVisualInstructions(
        body.medal_title,
        body.short_reason,
        body.meaning_focus ?? "",
        body.story ?? "",
      );
      return result;
    } catch (error) {
      request.log.error(error, "visual instruction generation failed");
      return reply.code(500).send({
        error: "visual instruction generation failed",
        detail: error instanceof Error ? error.message : "unknown error",
      });
    }
  });
}

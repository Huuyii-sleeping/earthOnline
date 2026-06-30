import type { FastifyInstance } from "fastify";
import {
  generateGrowthProfile,
  type GrowthMedalItem,
  type GrowthStageSummaryItem,
} from "../../graphs/growth-profile.graph.js";
import type { AgentRuntimeConfig } from "../../providers/index.js";

interface GenerateGrowthProfileBody {
  medals?: GrowthMedalItem[];
  stageSummaries?: GrowthStageSummaryItem[];
  agent_runtime?: AgentRuntimeConfig | null;
}

export async function growthProfileRoutes(app: FastifyInstance) {
  // Generate a long-term growth profile from medals and stage summaries.
  app.post("/growth/profile", async (request, reply) => {
    const body = request.body as GenerateGrowthProfileBody;

    const medals = body?.medals ?? [];
    const stageSummaries = body?.stageSummaries ?? [];

    if (medals.length === 0 && stageSummaries.length === 0) {
      return reply.code(400).send({
        error: "at least one of medals or stageSummaries is required",
      });
    }

    try {
      const result = await generateGrowthProfile(medals, stageSummaries, body.agent_runtime);
      return result;
    } catch (error) {
      request.log.error(error, "growth profile generation failed");
      return reply.code(500).send({
        error: "growth profile generation failed",
        detail: error instanceof Error ? error.message : "unknown error",
      });
    }
  });
}

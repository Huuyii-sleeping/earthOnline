import type { FastifyInstance } from "fastify";
import {
  generateStageSummary,
  type StageExperienceItem,
} from "../../graphs/stage-summary.graph.js";
import type { AgentRuntimeConfig } from "../../providers/index.js";

interface GenerateStageSummaryBody {
  period_label?: string;
  experiences?: StageExperienceItem[];
  agent_runtime?: AgentRuntimeConfig | null;
}

export async function stageRoutes(app: FastifyInstance) {
  // Generate a stage roll-up from a window of experiences.
  app.post("/stage/summary", async (request, reply) => {
    const body = request.body as GenerateStageSummaryBody;

    if (!body?.experiences || body.experiences.length === 0) {
      return reply.code(400).send({ error: "experiences is required" });
    }

    try {
      const result = await generateStageSummary(
        body.experiences,
        body.period_label ?? "这段时间",
        body.agent_runtime,
      );
      return result;
    } catch (error) {
      request.log.error(error, "stage summary generation failed");
      return reply.code(500).send({
        error: "stage summary generation failed",
        detail: error instanceof Error ? error.message : "unknown error",
      });
    }
  });
}

import type { FastifyInstance } from "fastify";
import {
  generateYearReview,
  type YearMedalItem,
  type YearStageItem,
  type GrowthProfileSnapshot,
  type YearReviewStats,
} from "../../graphs/year-review.graph.js";
import type { AgentRuntimeConfig } from "../../providers/index.js";

interface GenerateYearReviewBody {
  year?: number;
  medals?: YearMedalItem[];
  stage_summaries?: YearStageItem[];
  growth_profile?: GrowthProfileSnapshot;
  stats?: YearReviewStats;
  agent_runtime?: AgentRuntimeConfig | null;
}

export async function yearReviewRoutes(app: FastifyInstance) {
  // Generate a year-level review from annual medals, stage summaries and
  // growth profile snapshot.
  app.post("/year/review", async (request, reply) => {
    const body = request.body as GenerateYearReviewBody;

    const year = body?.year;
    if (!year || year < 2020 || year > 2100) {
      return reply.code(400).send({ error: "valid year (2020-2100) is required" });
    }

    const medals = body?.medals ?? [];
    const stageSummaries = body?.stage_summaries ?? [];
    const growthProfile = body?.growth_profile;
    const stats = body?.stats ?? {
      medalCount: medals.length,
      experienceCount: 0,
      stageSummaryCount: stageSummaries.length,
    };

    if (medals.length === 0 && stageSummaries.length === 0) {
      return reply.code(400).send({
        error: "at least one of medals or stage_summaries is required",
      });
    }

    try {
      const result = await generateYearReview(
        year,
        medals,
        stageSummaries,
        growthProfile,
        stats,
        body.agent_runtime,
      );
      return result;
    } catch (error) {
      request.log.error(error, "year review generation failed");
      return reply.code(500).send({
        error: "year review generation failed",
        detail: error instanceof Error ? error.message : "unknown error",
      });
    }
  });
}

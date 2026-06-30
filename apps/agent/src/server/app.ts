import Fastify from "fastify";
import { healthRoutes } from "./routes/health.js";
import { conversationRoutes } from "./routes/conversation.js";
import { medalRoutes } from "./routes/medal.js";
import { stageRoutes } from "./routes/stage.js";
import { growthProfileRoutes } from "./routes/growth-profile.js";
import { yearReviewRoutes } from "./routes/year-review.js";

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.register(healthRoutes);
  app.register(conversationRoutes);
  app.register(medalRoutes);
  app.register(stageRoutes);
  app.register(growthProfileRoutes);
  app.register(yearReviewRoutes);

  return app;
}

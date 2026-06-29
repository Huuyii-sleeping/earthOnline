import Fastify from "fastify";
import { healthRoutes } from "./routes/health.js";
import { conversationRoutes } from "./routes/conversation.js";

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.register(healthRoutes);
  app.register(conversationRoutes);

  return app;
}
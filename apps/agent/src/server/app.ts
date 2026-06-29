import Fastify from "fastify";
import { healthRoutes } from "./routes/health.js";
import { streamRoutes } from "./routes/stream.js";

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.register(healthRoutes);
  app.register(streamRoutes);

  return app;
}

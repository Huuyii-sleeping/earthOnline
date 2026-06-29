import { buildApp } from "./app.js";
import { env } from "./env.js";

const app = buildApp();

try {
  await app.listen({ port: env.AGENT_PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

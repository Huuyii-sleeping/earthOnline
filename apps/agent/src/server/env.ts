import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  AGENT_PORT: z.coerce.number().int().positive().default(8787),
  AGENT_SERVICE_URL: z.string().url().default("http://localhost:8787"),
  OPENAI_API_KEY: z.string().optional(),
});

export const env = envSchema.parse(process.env);

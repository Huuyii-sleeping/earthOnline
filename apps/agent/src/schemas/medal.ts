import { z } from "zod";
import type { MemoryWeight } from "@earth-online/shared";

export const medalGenerationSchema = z.object({
  title: z.string().min(1),
  shortReason: z.string().min(1),
  memoryWeight: z.enum(["light", "medium", "heavy"]),
  meaningFocus: z.string().min(1),
  story: z.string().min(1),
});

export type MedalGeneration = z.infer<typeof medalGenerationSchema>;

// Re-export shared types for convenience
export type { MemoryWeight };
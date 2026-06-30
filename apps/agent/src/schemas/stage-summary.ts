import { z } from "zod";
import type { MemoryWeight } from "@earth-online/shared";

export const stageSummarySchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  memoryWeight: z.enum(["light", "medium", "heavy"]),
  story: z.string().min(1),
  highlights: z.array(z.string()).default([]),
});

export type StageSummaryGeneration = z.infer<typeof stageSummarySchema>;

export type { MemoryWeight };

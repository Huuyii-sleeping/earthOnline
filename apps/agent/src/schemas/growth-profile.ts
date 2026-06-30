import { z } from "zod";

export const growthProfileSchema = z.object({
  summary: z.string().default(""),
  traitKeywords: z.array(z.string()).default([]),
  growthKeywords: z.array(z.string()).default([]),
  experienceTypes: z
    .array(
      z.object({
        type: z.string().min(1),
        weight: z.number().min(0).max(1),
      }),
    )
    .default([]),
  emotionTrends: z
    .array(
      z.object({
        label: z.string().min(1),
        summary: z.string().min(1),
      }),
    )
    .default([]),
  insights: z
    .array(
      z.object({
        title: z.string().min(1),
        summary: z.string().min(1),
        keywords: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  evidence: z
    .object({
      medalIds: z.array(z.string()).default([]),
      stageSummaryIds: z.array(z.string()).default([]),
      experienceIds: z.array(z.string()).default([]),
    })
    .default({ medalIds: [], stageSummaryIds: [], experienceIds: [] }),
});

export type GrowthProfileGeneration = z.infer<typeof growthProfileSchema>;

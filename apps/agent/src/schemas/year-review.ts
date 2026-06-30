import { z } from "zod";

export const yearReviewSchema = z.object({
  title: z.string().min(1).max(30),
  narrative: z.string().min(200).max(2000),
  annualThemes: z.array(z.string()).min(1).max(5),
  milestoneMedals: z
    .array(
      z.object({
        medalId: z.string().optional(),
        title: z.string(),
        shortReason: z.string(),
        milestoneType: z.enum(["action", "emotion", "growth", "relation"]),
        agentNote: z.string(),
      }),
    )
    .max(6)
    .default([]),
  growthArc: z.object({
    startState: z.string(),
    turningPoints: z.array(z.string()).max(3).default([]),
    endState: z.string(),
  }),
  emotionArc: z
    .array(
      z.object({
        period: z.string(),
        emotion: z.string(),
        summary: z.string(),
      }),
    )
    .max(4)
    .default([]),
  keywordEvolution: z.object({
    earlierKeywords: z.array(z.string()).default([]),
    laterKeywords: z.array(z.string()).default([]),
    shift: z.string(),
  }),
});

export type YearReviewGeneration = z.infer<typeof yearReviewSchema>;

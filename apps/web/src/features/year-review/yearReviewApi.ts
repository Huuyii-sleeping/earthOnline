import { apiClient } from "@/lib/api/client";

// --- Annual review (年度回顾 M9) ---

export interface MilestoneMedal {
  medalId?: string;
  title: string;
  shortReason: string;
  milestoneType: "action" | "emotion" | "growth" | "relation";
  agentNote: string;
}

export interface GrowthArc {
  startState: string;
  turningPoints: string[];
  endState: string;
}

export interface EmotionArcEntry {
  period: string;
  emotion: string;
  summary: string;
}

export interface KeywordEvolution {
  earlierKeywords: string[];
  laterKeywords: string[];
  shift: string;
}

export interface AnnualReview {
  id: string;
  user_id: string;
  year: number;
  status: string;
  title: string;
  narrative: string;
  annual_themes: string[];
  milestone_medals: MilestoneMedal[];
  growth_arc: GrowthArc;
  emotion_arc: EmotionArcEntry[];
  keyword_evolution: KeywordEvolution;
  medal_count: number;
  stage_summary_count: number;
  experience_count: number;
  generated_by: string;
  trigger: string;
  created_at: string;
  updated_at: string;
}

export interface PaginatedAnnualReviews {
  data: AnnualReview[];
  total: number;
  page: number;
  page_size: number;
}

/** GET /annual-reviews — 分页返回当前用户年度回顾 */
export async function listAnnualReviews(page = 1, pageSize = 20): Promise<PaginatedAnnualReviews> {
  const res = await apiClient.get<PaginatedAnnualReviews>(`/annual-reviews`, {
    params: { page, page_size: pageSize },
  });
  return res.data;
}

/** GET /annual-reviews/:year — 返回指定年份年度回顾 */
export async function getAnnualReview(year: number): Promise<AnnualReview> {
  const res = await apiClient.get<{ data: AnnualReview }>(`/annual-reviews/${year}`);
  return res.data.data;
}

/** POST /annual-reviews/generate — 手动生成年度回顾 */
export async function generateAnnualReview(year: number): Promise<AnnualReview> {
  const res = await apiClient.post<{ data: AnnualReview }>(`/annual-reviews/generate`, {
    year,
  });
  return res.data.data;
}

/** DELETE /annual-reviews/:year — 删除年度回顾 */
export async function deleteAnnualReview(year: number): Promise<void> {
  await apiClient.delete(`/annual-reviews/${year}`);
}

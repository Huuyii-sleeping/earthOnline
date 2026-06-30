import { apiClient } from "@/lib/api/client";
import type { FeedItem, FeedTab, PaginatedResponse } from "@earth-online/shared";

// --- Feed API ---

/** GET /feed?tab=&page=&page_size= — 社交流分页查询 */
export async function getFeed(
  tab: FeedTab = "latest",
  page = 1,
  pageSize = 20,
): Promise<PaginatedResponse<FeedItem>> {
  const res = await apiClient.get<PaginatedResponse<FeedItem>>("/feed", {
    params: { tab, page, page_size: pageSize },
  });
  return res.data;
}

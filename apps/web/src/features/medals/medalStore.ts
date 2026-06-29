import { create } from "zustand";

export type MedalVisibility = "public" | "private";

export interface ExperienceMedal {
  id: string;
  title: string;
  summary: string;
  detail: string;
  tags: string[];
  visibility: MedalVisibility;
  createdAt: string;
  source: "agent" | "mock";
}

export interface MedalDraft {
  title: string;
  summary: string;
  detail: string;
  tags: string[];
  visibility: MedalVisibility;
  source: "agent" | "mock";
}

interface MedalStoreState {
  medals: ExperienceMedal[];
  addMedal: (draft: MedalDraft) => ExperienceMedal;
  updateVisibility: (id: string, visibility: MedalVisibility) => void;
  removeMedal: (id: string) => void;
  getMedal: (id: string) => ExperienceMedal | undefined;
}

const STORAGE_KEY = "earth_online_experience_medals";

function readMedals(): ExperienceMedal[] {
  if (typeof window === "undefined") return [];

  try {
    const rawMedals = window.localStorage.getItem(STORAGE_KEY);
    if (!rawMedals) return [];
    const parsedMedals = JSON.parse(rawMedals) as ExperienceMedal[];

    if (!Array.isArray(parsedMedals)) return [];

    return parsedMedals.filter(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        typeof item.summary === "string" &&
        typeof item.detail === "string" &&
        Array.isArray(item.tags) &&
        (item.visibility === "public" || item.visibility === "private"),
    );
  } catch {
    return [];
  }
}

function writeMedals(medals: ExperienceMedal[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(medals));
}

function createMedalId() {
  return `medal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useMedalStore = create<MedalStoreState>((set, get) => ({
  medals: readMedals(),
  addMedal: (draft) => {
    const medal: ExperienceMedal = {
      ...draft,
      id: createMedalId(),
      createdAt: new Date().toISOString(),
      tags: draft.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 5),
    };
    const nextMedals = [medal, ...get().medals];
    writeMedals(nextMedals);
    set({ medals: nextMedals });
    return medal;
  },
  updateVisibility: (id, visibility) => {
    const nextMedals = get().medals.map((medal) =>
      medal.id === id ? { ...medal, visibility } : medal,
    );
    writeMedals(nextMedals);
    set({ medals: nextMedals });
  },
  removeMedal: (id) => {
    const nextMedals = get().medals.filter((medal) => medal.id !== id);
    writeMedals(nextMedals);
    set({ medals: nextMedals });
  },
  getMedal: (id) => get().medals.find((medal) => medal.id === id),
}));

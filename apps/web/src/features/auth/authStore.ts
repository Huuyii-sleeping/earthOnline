import { create } from "zustand";
import { getAccessToken, setTokens, clearTokens, setAuthProfile, getAuthProfile } from "@/lib/auth/token";

const restoredToken = getAccessToken();
const restoredProfile = getAuthProfile();

interface AuthState {
  isAuthenticated: boolean;
  userId: string | null;
  nickname: string | null;
  setAuth: (userId: string, nickname: string, accessToken: string, refreshToken: string) => void;
  logout: () => void;
  restore: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: Boolean(restoredToken),
  userId: restoredProfile.userId,
  nickname: restoredProfile.nickname,
  setAuth: (userId, nickname, accessToken, refreshToken) => {
    setTokens(accessToken, refreshToken);
    setAuthProfile(userId, nickname);
    set({ isAuthenticated: true, userId, nickname });
  },
  logout: () => {
    clearTokens();
    set({ isAuthenticated: false, userId: null, nickname: null });
  },
  restore: () => {
    const token = getAccessToken();
    if (token) {
      const { userId, nickname } = getAuthProfile();
      set({ isAuthenticated: true, userId, nickname });
    }
  },
}));

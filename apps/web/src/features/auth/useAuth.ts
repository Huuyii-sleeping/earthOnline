import { useAuthStore } from "./authStore";

export function useAuth() {
  const store = useAuthStore();
  return {
    isAuthenticated: store.isAuthenticated,
    userId: store.userId,
    nickname: store.nickname,
    setAuth: store.setAuth,
    logout: store.logout,
    restore: store.restore,
  };
}

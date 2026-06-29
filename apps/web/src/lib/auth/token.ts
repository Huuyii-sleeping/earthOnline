const ACCESS_TOKEN_KEY = "access_token";
const REFRESH_TOKEN_KEY = "refresh_token";
const USER_ID_KEY = "auth_user_id";
const NICKNAME_KEY = "auth_nickname";

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function setAuthProfile(userId: string, nickname: string) {
  localStorage.setItem(USER_ID_KEY, userId);
  localStorage.setItem(NICKNAME_KEY, nickname);
}

export function getAuthProfile(): { userId: string | null; nickname: string | null } {
  return {
    userId: localStorage.getItem(USER_ID_KEY),
    nickname: localStorage.getItem(NICKNAME_KEY),
  };
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_ID_KEY);
  localStorage.removeItem(NICKNAME_KEY);
}

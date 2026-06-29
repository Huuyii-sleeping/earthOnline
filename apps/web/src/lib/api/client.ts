import axios from "axios";
import { getAccessToken } from "@/lib/auth/token";
import { setupTokenRefreshInterceptor } from "@/lib/api/interceptors";

export const apiClient = axios.create({
  baseURL: "/api/v1",
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Attach access token to every request
apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Setup token refresh interceptor (handles 401 with auto-refresh)
setupTokenRefreshInterceptor(apiClient);
import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import type { ApiClientConfig } from './types';

export function createApiClient(config: ApiClientConfig): AxiosInstance {
  const {
    baseUrl,
    tokenStorage,
    withCredentials = false,
    getRefreshToken,
    onTokenRefreshed,
    onRefreshTokenRotated,
    onSessionExpired,
  } = config;

  let refreshPromise: Promise<string> | null = null;
  let sessionDead = false;

  async function silentRefresh(): Promise<string> {
    if (sessionDead) return Promise.reject(new Error('Session expired'));
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      // Mobile has no cookie jar, so it has its own endpoint that reads the
      // refresh token from a header and returns a rotated one in the body --
      // the shared cookie-only /auth/refresh never puts a token in the body
      // (that's load-bearing for web's XSS protection, see auth.controller.ts).
      if (!withCredentials) {
        const refreshToken = getRefreshToken?.();
        if (!refreshToken) {
          sessionDead = true;
          throw new Error('Session expired');
        }

        const response = await axios.post<{ accessToken: string; refreshToken: string }>(
          `${baseUrl}/auth/mobile/refresh`,
          {},
          { headers: { 'X-Refresh-Token': refreshToken } },
        );

        const { accessToken, refreshToken: newRefreshToken } = response.data;
        sessionDead = false;
        tokenStorage.setAccessToken(accessToken);
        onTokenRefreshed?.(accessToken);
        onRefreshTokenRotated?.(newRefreshToken);
        return accessToken;
      }

      const response = await axios.post<{ accessToken: string }>(
        `${baseUrl}/auth/refresh`,
        {},
        { withCredentials: true },
      );

      const token = response.data.accessToken;
      sessionDead = false;
      tokenStorage.setAccessToken(token);
      onTokenRefreshed?.(token);
      return token;
    })()
      .catch((err: unknown) => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 401) {
          sessionDead = true;
        }
        throw err;
      })
      .finally(() => {
        refreshPromise = null;
      });

    return refreshPromise;
  }

  const client = axios.create({
    baseURL: baseUrl,
    timeout: 30000,
    withCredentials,
    headers: { 'Content-Type': 'application/json' },
  });

  client.interceptors.request.use((req) => {
    const token = tokenStorage.getAccessToken();
    if (token && req.headers) {
      req.headers['Authorization'] = `Bearer ${token}`;
    }
    return req;
  });

  client.interceptors.response.use(
    (response) => {
      sessionDead = false;
      return response;
    },
    async (error: unknown) => {
      const axiosError = error as { config?: AxiosRequestConfig & { _retry?: boolean }; response?: { status?: number } };
      const originalRequest = axiosError.config;

      if (axiosError.response?.status === 401 && originalRequest && !originalRequest._retry) {
        originalRequest._retry = true;
        try {
          const newToken = await silentRefresh();
          if (originalRequest.headers) {
            (originalRequest.headers as Record<string, string>)['Authorization'] = `Bearer ${newToken}`;
          }
          return client(originalRequest);
        } catch {
          if (sessionDead) {
            tokenStorage.clearAccessToken();
            onSessionExpired?.();
          }
        }
      }
      return Promise.reject(error);
    },
  );

  return client;
}

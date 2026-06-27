import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import type { ApiClientConfig } from './types';

export function createApiClient(config: ApiClientConfig): AxiosInstance {
  const {
    baseUrl,
    tokenStorage,
    withCredentials = false,
    getRefreshToken,
    onTokenRefreshed,
    onSessionExpired,
  } = config;

  let refreshPromise: Promise<string> | null = null;
  let sessionDead = false;

  async function silentRefresh(): Promise<string> {
    if (sessionDead) return Promise.reject(new Error('Session expired'));
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      const headers: Record<string, string> = {};
      // Mobile path: send refresh token as a header
      const refreshToken = getRefreshToken?.();
      if (!withCredentials && refreshToken) {
        headers['X-Refresh-Token'] = refreshToken;
      }

      const response = await axios.post<{ accessToken: string }>(
        `${baseUrl}/auth/refresh`,
        {},
        {
          withCredentials,
          headers,
        },
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

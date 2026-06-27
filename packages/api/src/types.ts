export interface TokenStorage {
  getAccessToken(): string | null;
  setAccessToken(token: string): void;
  clearAccessToken(): void;
}

export interface ApiClientConfig {
  baseUrl: string;
  tokenStorage: TokenStorage;
  /**
   * Set to true on web to use HttpOnly cookie refresh flow.
   * Set to false on mobile (will use getRefreshToken header flow).
   */
  withCredentials?: boolean;
  /** Mobile only: returns the stored refresh token for header-based refresh */
  getRefreshToken?: () => string | null;
  /** Called when a new access token is issued (e.g. update in-memory store) */
  onTokenRefreshed?: (accessToken: string) => void;
  /** Called when the session is permanently expired */
  onSessionExpired?: () => void;
}

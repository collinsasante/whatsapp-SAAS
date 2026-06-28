export interface SocketConfig {
  url: string;
  getToken: () => string | null;
  onAuthError?: () => void;
  onConnect?: () => void;
  onDisconnect?: (reason: string) => void;
}

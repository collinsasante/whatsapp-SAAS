import { io, type Socket } from 'socket.io-client';
import type { SocketConfig } from './types';

export class VerzChatSocket {
  private socket: Socket | null = null;
  private authorizedSocket: Socket | null = null;
  private config: SocketConfig;

  constructor(config: SocketConfig) {
    this.config = config;
  }

  get instance(): Socket | null {
    return this.socket;
  }

  connect(): Socket {
    const token = this.config.getToken();

    if (this.socket) {
      const prevToken = (this.socket.auth as { token?: string | null })?.token ?? null;
      if (prevToken !== token) {
        this.authorizedSocket = null;
        this.socket.disconnect();
        this.socket = null;
      }
    }

    if (!this.socket) {
      this.socket = io(this.config.url, {
        auth: { token },
        transports: ['websocket', 'polling'],
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 30000,
      });

      this.socket.on('connect', () => {
        this.authorizedSocket = this.socket;
        this.config.onConnect?.();
      });

      this.socket.on('disconnect', (reason: string) => {
        this.config.onDisconnect?.(reason);
      });

      this.socket.on('connect_error', (err: Error) => {
        const isAuthorized = this.socket === this.authorizedSocket;
        if (!isAuthorized) return;
        const isAuthError =
          err.message.toLowerCase().includes('authentication') ||
          err.message.toLowerCase().includes('token');
        if (isAuthError) {
          this.config.onAuthError?.();
        }
      });
    }

    return this.socket;
  }

  disconnect(): void {
    this.authorizedSocket = null;
    this.socket?.disconnect();
    this.socket = null;
  }

  emit(event: string, ...args: unknown[]): void {
    this.socket?.emit(event, ...args);
  }

  on(event: string, callback: (...args: unknown[]) => void): void {
    this.socket?.on(event, callback);
  }

  off(event: string, callback?: (...args: unknown[]) => void): void {
    this.socket?.off(event, callback);
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }
}

export function createVerzChatSocket(config: SocketConfig): VerzChatSocket {
  return new VerzChatSocket(config);
}

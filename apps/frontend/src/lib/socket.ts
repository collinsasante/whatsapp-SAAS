import { io, Socket } from 'socket.io-client';
import { SocketEvent } from '@whatsapp-platform/shared-types';

const SOCKET_URL = process.env['NEXT_PUBLIC_SOCKET_URL'] ?? 'http://localhost:3002';

let socket: Socket | null = null;

type AuthErrorCallback = () => void;
let onAuthError: AuthErrorCallback | null = null;

export function setSocketAuthErrorHandler(cb: AuthErrorCallback) {
  onAuthError = cb;
}

function createSocket(token: string | null): Socket {
  const s = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });
  s.on('connect', () => console.log('Socket connected'));
  s.on('disconnect', (reason) => console.log('Socket disconnected:', reason));
  s.on('connect_error', (err) => {
    if (err.message.toLowerCase().includes('authentication') || err.message.toLowerCase().includes('token')) {
      onAuthError?.();
    } else {
      console.error('Socket error:', err.message);
    }
  });
  return s;
}

export function getSocket(): Socket {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;

  if (socket) {
    const prevToken = (socket.auth as { token?: string | null })?.token ?? null;
    if (prevToken !== token) {
      // Token changed (e.g. just logged in) — reconnect with fresh credentials
      socket.disconnect();
      socket = null;
    }
  }

  if (!socket) {
    socket = createSocket(token);
  }

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export { SocketEvent };

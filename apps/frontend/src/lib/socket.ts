import { io, Socket } from 'socket.io-client';
import { SocketEvent } from '@whatsapp-platform/shared-types';

const SOCKET_URL = process.env['NEXT_PUBLIC_SOCKET_URL'] ?? 'http://localhost:3002';

let socket: Socket | null = null;
// Only the currently-authorized socket may trigger the auth error handler.
// This prevents stale sockets from an expired session from logging out a fresh login.
let authorizedSocket: Socket | null = null;

type AuthErrorCallback = () => void;
let onAuthError: AuthErrorCallback | null = null;

export function setSocketAuthErrorHandler(cb: AuthErrorCallback | null) {
  onAuthError = cb;
}

// Call this when SocketProvider unmounts so stale socket events can't fire
// the handler for a new session that hasn't fully initialized yet.
export function clearSocketAuth() {
  onAuthError = null;
  authorizedSocket = null;
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
    console.log('[SOCKET] connect_error', { msg: err.message, isAuthorized: s === authorizedSocket });
    // Only handle auth errors for the currently-authorized socket instance.
    // Stale sockets from a previous session must never trigger logout of a new session.
    if (s !== authorizedSocket) return;
    if (err.message.toLowerCase().includes('authentication') || err.message.toLowerCase().includes('token')) {
      console.log('[SOCKET] auth connect_error → firing onAuthError');
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
      // Token changed — deauthorize before disconnecting so any pending connect_error
      // events from the old socket are silently ignored.
      authorizedSocket = null;
      socket.disconnect();
      socket = null;
    }
  }

  if (!socket) {
    socket = createSocket(token);
    authorizedSocket = socket;
  }

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    authorizedSocket = null;
    socket.disconnect();
    socket = null;
  }
}

export { SocketEvent };

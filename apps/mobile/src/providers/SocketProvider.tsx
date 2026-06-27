import React, { createContext, useContext, useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { socketClient } from '../lib/socket';
import { useAuthStore } from '../store/auth.store';

const SocketContext = createContext<{ socket: Socket | null }>({ socket: null });

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (isAuthenticated) {
      socketRef.current = socketClient.connect();
    } else {
      socketClient.disconnect();
      socketRef.current = null;
    }

    return () => {
      socketClient.disconnect();
      socketRef.current = null;
    };
  }, [isAuthenticated]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket(): Socket | null {
  return useContext(SocketContext).socket;
}

import React from 'react';
import { QueryProvider } from './QueryProvider';
import { SocketProvider } from './SocketProvider';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <SocketProvider>{children}</SocketProvider>
    </QueryProvider>
  );
}

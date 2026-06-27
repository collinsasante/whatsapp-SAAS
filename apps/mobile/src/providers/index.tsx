import React from 'react';
import { QueryProvider } from './QueryProvider';
import { SocketProvider } from './SocketProvider';
import { NotificationProvider } from './NotificationProvider';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <SocketProvider>
        <NotificationProvider>{children}</NotificationProvider>
      </SocketProvider>
    </QueryProvider>
  );
}

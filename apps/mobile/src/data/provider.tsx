/** Wires the gateway seam + TanStack Query. Swap `defaultGateway` for the real
 *  HTTP/WS impl later — nothing else changes. */
import React, { createContext, useContext, useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { SessionGateway } from './gateway';
import { MockSessionGateway } from './mock/mock-gateway';
import { AuthProvider } from './auth';

const GatewayContext = createContext<SessionGateway | null>(null);

export function useGateway(): SessionGateway {
  const g = useContext(GatewayContext);
  if (!g) throw new Error('useGateway must be used within <AppProviders>');
  return g;
}

export function AppProviders({
  children,
  gateway,
}: {
  children: React.ReactNode;
  gateway?: SessionGateway;
}) {
  const client = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5_000 } } }), []);
  const gw = useMemo(() => gateway ?? new MockSessionGateway(), [gateway]);
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <GatewayContext.Provider value={gw}>{children}</GatewayContext.Provider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

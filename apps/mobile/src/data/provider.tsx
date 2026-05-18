/** Wires the gateway seam + TanStack Query. Swaps MockSessionGateway for
 *  HttpSessionGateway when the active profile is real. Auth token is read from
 *  secure store by HttpSessionGateway on every request. */
import React, { createContext, useContext, useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { SessionGateway } from './gateway';
import { HttpSessionGateway } from './gateway/http';
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
  gatewayUrl,
}: {
  children: React.ReactNode;
  gatewayUrl?: string;
}) {
  const client = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5_000 } } }),
    [],
  );

  const gw = useMemo<SessionGateway>(() => {
    if (gatewayUrl && !gatewayUrl.startsWith('mock://')) {
      return new HttpSessionGateway(gatewayUrl.replace(/\/$/, ''));
    }
    return new MockSessionGateway();
  }, [gatewayUrl]);

  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <GatewayContext.Provider value={gw}>{children}</GatewayContext.Provider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

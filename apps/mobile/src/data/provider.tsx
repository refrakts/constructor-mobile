/** Wires the gateway seam + TanStack Query. Swaps MockSessionGateway for
 *  HttpSessionGateway when the active profile is real. Auth token is read from
 *  secure store by HttpSessionGateway on every request. */
import React, { createContext, useContext, useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { SessionGateway } from './gateway';
import { HttpSessionGateway } from './gateway/http';
import { MockSessionGateway } from './mock/mock-gateway';
import { AuthProvider, authTokenKey } from './auth';
import { PushRegistration } from './push';

const GatewayContext = createContext<SessionGateway | null>(null);
const GatewayScopeContext = createContext<string>('mock');

export function useGateway(): SessionGateway {
  const g = useContext(GatewayContext);
  if (!g) throw new Error('useGateway must be used within <AppProviders>');
  return g;
}

export function useGatewayScope(): string {
  return useContext(GatewayScopeContext);
}

export function AppProviders({
  children,
  gatewayUrl,
  profileId,
  wsUrl,
}: {
  children: React.ReactNode;
  gatewayUrl?: string;
  profileId?: string;
  wsUrl?: string;
}) {
  const client = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5_000 } } }),
    [],
  );

  const gw = useMemo<SessionGateway>(() => {
    if (gatewayUrl && !gatewayUrl.startsWith('mock://')) {
      return new HttpSessionGateway(
        gatewayUrl.replace(/\/$/, ''),
        authTokenKey(profileId),
        wsUrl?.replace(/\/$/, ''),
      );
    }
    return new MockSessionGateway();
  }, [gatewayUrl, profileId, wsUrl]);

  const scope = profileId ?? gatewayUrl ?? 'mock';

  return (
    <QueryClientProvider client={client}>
      <AuthProvider profileId={profileId}>
        <GatewayScopeContext.Provider value={scope}>
          <GatewayContext.Provider value={gw}>{children}</GatewayContext.Provider>
          <PushRegistration gatewayUrl={gatewayUrl} />
        </GatewayScopeContext.Provider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

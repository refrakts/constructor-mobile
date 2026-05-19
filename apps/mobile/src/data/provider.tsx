/**
 * Wires the gateway seam + TanStack Query.
 *
 *  - Selects MockSessionGateway when no profile (or mock://) is configured.
 *  - For real profiles, refuses to construct an HttpSessionGateway without a
 *    discovered `wsBaseUrl` (otherwise WS silently dies). Triggers a /config
 *    discovery if the profile lacks one.
 *  - Wraps the QueryClient with structured error handling: 401 from the
 *    gateway transparently attempts a /auth/refresh and re-runs the query,
 *    else triggers sign-out so the user is sent back to /sign-in.
 *  - Initialises LogRocket and identifies the user.
 */
import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { SessionGateway } from './gateway';
import { HttpSessionGateway, refreshAppJwt } from './gateway/http';
import { MockSessionGateway } from './mock/mock-gateway';
import { AuthProvider, authTokenKey, useAuth } from './auth';
import { PushRegistration } from './push';
import { useProfileStore } from '@/features/profiles/profile-store';
import { GatewayError } from './errors';
import { useGatewayConfig } from './config';
import {
  captureException,
  identifyUser,
  initLogRocket,
  logEvent,
} from '@/observability/logrocket';

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
  // One-time LogRocket init.
  useEffect(() => {
    initLogRocket();
  }, []);

  const scope = profileId ?? gatewayUrl ?? 'mock';
  const tokenKey = authTokenKey(profileId);
  const isRealProfile = !!gatewayUrl && !gatewayUrl.startsWith('mock://');

  const gw = useMemo<SessionGateway>(() => {
    if (isRealProfile && gatewayUrl) {
      return new HttpSessionGateway(
        gatewayUrl.replace(/\/$/, ''),
        tokenKey,
        wsUrl?.replace(/\/$/, ''),
      );
    }
    return new MockSessionGateway();
  }, [gatewayUrl, isRealProfile, tokenKey, wsUrl]);

  // Single shared error router for queries + mutations. Avoids a refresh
  // storm by collapsing concurrent 401s into one in-flight refresh.
  const refreshLock = useRef<Promise<boolean> | null>(null);
  // Populated by an inner <AuthBridge /> rendered under AuthProvider. The
  // QueryClient onError closure runs *outside* the auth context, so it can't
  // call useAuth(); we instead reach into this ref. When a refresh fails we
  // sign out, which flips `signedIn` in AuthContext and the Stack.Protected
  // guards in `_layout.tsx` send the user to /sign-in.
  const signOutRef = useRef<(() => void) | null>(null);

  const tryRefresh = useMemo(() => {
    return async (): Promise<boolean> => {
      if (!isRealProfile || !gatewayUrl) return false;
      if (refreshLock.current) return refreshLock.current;
      const promise = (async () => {
        const fresh = await refreshAppJwt(gatewayUrl.replace(/\/$/, ''), tokenKey);
        return !!fresh;
      })();
      refreshLock.current = promise;
      try {
        return await promise;
      } finally {
        refreshLock.current = null;
      }
    };
  }, [gatewayUrl, isRealProfile, tokenKey]);

  const client = useMemo(() => {
    // Forward-ref pattern: caches need a reference to the QueryClient (for
    // invalidate-on-refresh), but the QueryClient takes the caches in its
    // constructor. We close over a mutable holder and fill it after `new`.
    const clientRef: { current: QueryClient | null } = { current: null };

    const onError = (
      err: unknown,
      source: 'query' | 'mutation',
      meta: Record<string, unknown>,
    ) => {
      if (err instanceof GatewayError) {
        logEvent(err.kind === 'unauthorized' ? 'warn' : 'error', `data.${source}.failed`, {
          ...meta,
          ...err.toJSON(),
        });
        if (err.kind === 'unauthorized') {
          void tryRefresh().then((refreshed) => {
            if (refreshed) {
              logEvent('log', 'auth.token_refreshed', meta);
              clientRef.current?.invalidateQueries();
            } else {
              logEvent('warn', 'auth.refresh_failed', meta);
              // Refresh failed — KV record gone, signing key rotated, etc.
              // Boot the user back to /sign-in via AuthContext.signOut.
              signOutRef.current?.();
            }
          });
        }
      } else {
        captureException(err, { source, ...meta });
      }
    };

    const queryCache = new QueryCache({
      onError: (err, query) => onError(err, 'query', { queryKey: query.queryKey }),
    });
    const mutationCache = new MutationCache({
      onError: (err, _vars, _ctx, mutation) =>
        onError(err, 'mutation', { mutationKey: mutation.options.mutationKey }),
    });
    const qc = new QueryClient({
      queryCache,
      mutationCache,
      defaultOptions: {
        queries: {
          retry: (failureCount, error) => {
            if (error instanceof GatewayError) {
              if (['unauthorized', 'forbidden', 'not_found', 'bad_request'].includes(error.kind)) {
                return false;
              }
            }
            return failureCount < 2;
          },
          staleTime: 5_000,
        },
      },
    });
    clientRef.current = qc;
    return qc;
  }, [tryRefresh]);

  return (
    <QueryClientProvider client={client}>
      <AuthProvider profileId={profileId}>
        <GatewayScopeContext.Provider value={scope}>
          <ProfileBoot gatewayUrl={gatewayUrl} wsUrl={wsUrl} />
          <UserIdentity />
          <AuthBridge signOutRef={signOutRef} />
          <GatewayContext.Provider value={gw}>{children}</GatewayContext.Provider>
          <PushRegistration gatewayUrl={gatewayUrl} />
        </GatewayScopeContext.Provider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

/**
 * For real profiles without a discovered wsUrl, do a one-shot /config fetch
 * so the gateway can ship its wsUrl back. Mock profiles skip this.
 */
function ProfileBoot({ gatewayUrl, wsUrl }: { gatewayUrl?: string; wsUrl?: string }) {
  const { fetchConfig } = useGatewayConfig();
  useEffect(() => {
    if (!gatewayUrl || gatewayUrl.startsWith('mock://')) return;
    if (wsUrl) return;
    fetchConfig().catch((err) => {
      logEvent('warn', 'config.discover_failed', {
        gatewayUrl,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, [gatewayUrl, wsUrl, fetchConfig]);
  return null;
}

/**
 * Bridges the AuthContext's `signOut` into the QueryClient's onError closure
 * (which lives outside the AuthProvider tree). Updates the ref on every
 * render so it always points at the latest stable signOut.
 */
function AuthBridge({ signOutRef }: { signOutRef: React.MutableRefObject<(() => void) | null> }) {
  const { signOut } = useAuth();
  useEffect(() => {
    signOutRef.current = signOut;
    return () => {
      signOutRef.current = null;
    };
  }, [signOut, signOutRef]);
  return null;
}

/** Identify the LogRocket session as soon as we have a signed-in user. */
function UserIdentity() {
  const { user } = useAuth();
  const { activeProfile } = useProfileStore();
  useEffect(() => {
    if (!user?.sub) return;
    identifyUser(user.sub, {
      scmLogin: user.scmLogin,
      scmName: user.scmName,
      scmEmail: user.scmEmail,
      profileId: activeProfile?.id ?? 'unknown',
      gateway: activeProfile?.gatewayUrl ?? 'unknown',
    });
  }, [user, activeProfile?.id, activeProfile?.gatewayUrl]);
  return null;
}

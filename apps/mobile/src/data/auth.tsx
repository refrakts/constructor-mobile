/**
 * Auth state backed by expo-secure-store. The JWT (issued by the gateway) is
 * persisted across reloads and included in every API call via the gateway.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import * as SecureStore from 'expo-secure-store';

const AUTH_KEY = 'constructor.auth_token';

type AuthUser = {
  sub: string;
  scmLogin: string;
  scmName: string;
  scmEmail: string;
};

type Auth = {
  signedIn: boolean;
  token: string | null;
  user: AuthUser | null;
  signIn: (token: string) => void;
  signOut: () => void;
};

const AuthContext = createContext<Auth | null>(null);

function parseJwtPayload(token: string): AuthUser | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const data = JSON.parse(json);
    return {
      sub: data.sub ?? '',
      scmLogin: data.scmLogin ?? '',
      scmName: data.scmName ?? '',
      scmEmail: data.scmEmail ?? '',
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Hydrate from secure store on mount
  useEffect(() => {
    SecureStore.getItemAsync(AUTH_KEY)
      .then((t) => {
        if (t) setToken(t);
      })
      .catch(() => {
        // ignore
      })
      .finally(() => setReady(true));
  }, []);

  const signIn = useCallback((newToken: string) => {
    setToken(newToken);
    SecureStore.setItemAsync(AUTH_KEY, newToken).catch(() => {
      // ignore
    });
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    SecureStore.deleteItemAsync(AUTH_KEY).catch(() => {
      // ignore
    });
  }, []);

  const user = useMemo(() => (token ? parseJwtPayload(token) : null), [token]);
  const value = useMemo<Auth>(
    () => ({
      signedIn: !!token,
      token,
      user,
      signIn,
      signOut,
    }),
    [token, user, signIn, signOut],
  );

  if (!ready) return null;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AppProviders>');
  return ctx;
}

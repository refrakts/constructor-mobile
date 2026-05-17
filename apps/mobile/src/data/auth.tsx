/**
 * Mock auth state for the navigation gate. Real GitHub OAuth (via the gateway)
 * is M1 — this only flips a boolean so `Stack.Protected` in the router can gate
 * the app behind sign-in. State is in-memory (resets on reload) by design: it
 * is a UI gate, not a credential store.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

type Auth = {
  signedIn: boolean;
  signIn: () => void;
  signOut: () => void;
};

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [signedIn, setSignedIn] = useState(false);
  const signIn = useCallback(() => setSignedIn(true), []);
  const signOut = useCallback(() => setSignedIn(false), []);
  const value = useMemo<Auth>(
    () => ({ signedIn, signIn, signOut }),
    [signedIn, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AppProviders>');
  return ctx;
}

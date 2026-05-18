/**
 * Connection-profile store (profiles slice), persisted via expo-sqlite/kv-store.
 *
 * PLAN-02 model: a profile is `{ id; name; gatewayUrl; wsUrl? }`. The user
 * enters ONLY `name` + `gatewayUrl`; `wsUrl` is discovered later from the
 * gateway's `GET /config` (NOT asked for here). Exactly one profile is active.
 *
 * Persistence: state is hydrated synchronously from `expo-sqlite/kv-store`
 * (`Storage.getItemSync`) so there is no first-paint flash, and written back on
 * every change. The public API (add/update/remove/setActive + selectors) is
 * unchanged, so screens are unaffected by the storage backend.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from 'react';
import { randomUUID } from 'expo-crypto';
import { Storage } from 'expo-sqlite/kv-store';

const KV_KEY = 'constructor.profiles.v1';

export type Profile = {
  id: string;
  name: string;
  gatewayUrl: string;
  /** Discovered from the gateway's GET /config — never user-entered. */
  wsUrl?: string;
  /** GitHub OAuth client id returned by GET /config — used for login. */
  githubOAuthClientId?: string;
};

/** Fields the user actually edits in the UI. */
export type ProfileDraft = { name: string; gatewayUrl: string };

/** Discovered config from a gateway — written back into the profile. */
export type ProfileConfig = { wsUrl: string; githubOAuthClientId: string };

type State = {
  profiles: Profile[];
  activeProfileId: string | null;
};

type Action =
  | { type: 'add'; profile: Profile }
  | { type: 'update'; id: string; draft: ProfileDraft }
  | { type: 'setConfig'; id: string; config: ProfileConfig }
  | { type: 'remove'; id: string }
  | { type: 'setActive'; id: string };

function makeId(): string {
  return `p_${randomUUID()}`;
}

const SEED: State = (() => {
  const seed: Profile = {
    id: makeId(),
    name: 'Local mock',
    gatewayUrl: 'mock://local',
  };
  return { profiles: [seed], activeProfileId: seed.id };
})();

/** Synchronous hydrate; falls back to SEED on missing/corrupt/unavailable. */
function loadInitialState(): State {
  try {
    const raw = Storage.getItemSync(KV_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<State>;
      if (parsed && Array.isArray(parsed.profiles) && parsed.profiles.length > 0) {
        const profiles = parsed.profiles as Profile[];
        const activeProfileId =
          parsed.activeProfileId && profiles.some((p) => p.id === parsed.activeProfileId)
            ? parsed.activeProfileId
            : profiles[0].id;
        return { profiles, activeProfileId };
      }
    }
  } catch {
    // missing / corrupt / storage unavailable → seed
  }
  return SEED;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'add': {
      const profiles = [...state.profiles, action.profile];
      const activeProfileId = state.activeProfileId ?? action.profile.id;
      return { profiles, activeProfileId };
    }
    case 'update': {
      const profiles = state.profiles.map((p) =>
        p.id === action.id
          ? {
              ...p,
              name: action.draft.name.trim(),
              gatewayUrl: action.draft.gatewayUrl.trim(),
              wsUrl:
                p.gatewayUrl.trim() === action.draft.gatewayUrl.trim()
                  ? p.wsUrl
                  : undefined,
              githubOAuthClientId:
                p.gatewayUrl.trim() === action.draft.gatewayUrl.trim()
                  ? p.githubOAuthClientId
                  : undefined,
            }
          : p,
      );
      return { ...state, profiles };
    }
    case 'setConfig': {
      const profiles = state.profiles.map((p) =>
        p.id === action.id
          ? {
              ...p,
              wsUrl: action.config.wsUrl,
              githubOAuthClientId: action.config.githubOAuthClientId,
            }
          : p,
      );
      return { ...state, profiles };
    }
    case 'remove': {
      const profiles = state.profiles.filter((p) => p.id !== action.id);
      let activeProfileId = state.activeProfileId;
      if (activeProfileId === action.id) {
        activeProfileId = profiles[0]?.id ?? null;
      }
      return { profiles, activeProfileId };
    }
    case 'setActive': {
      if (!state.profiles.some((p) => p.id === action.id)) return state;
      return { ...state, activeProfileId: action.id };
    }
    default:
      return state;
  }
}

type ProfileStore = {
  profiles: Profile[];
  activeProfileId: string | null;
  activeProfile: Profile | null;
  addProfile: (draft: ProfileDraft) => Profile;
  updateProfile: (id: string, draft: ProfileDraft) => void;
  setProfileConfig: (id: string, config: ProfileConfig) => void;
  removeProfile: (id: string) => void;
  setActiveProfile: (id: string) => void;
};

const ProfileStoreContext = createContext<ProfileStore | null>(null);

export function ProfileStoreProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitialState);

  // Persist on every change. Synchronous + best-effort: a storage failure must
  // never crash the UI (the in-memory state remains the source of truth).
  useEffect(() => {
    try {
      Storage.setItemSync(KV_KEY, JSON.stringify(state));
    } catch {
      // ignore — non-fatal
    }
  }, [state]);

  const addProfile = useCallback((draft: ProfileDraft): Profile => {
    const profile: Profile = {
      id: makeId(),
      name: draft.name.trim(),
      gatewayUrl: draft.gatewayUrl.trim(),
    };
    dispatch({ type: 'add', profile });
    return profile;
  }, []);

  const updateProfile = useCallback((id: string, draft: ProfileDraft) => {
    dispatch({ type: 'update', id, draft });
  }, []);

  const setProfileConfig = useCallback((id: string, config: ProfileConfig) => {
    dispatch({ type: 'setConfig', id, config });
  }, []);

  const removeProfile = useCallback((id: string) => {
    dispatch({ type: 'remove', id });
  }, []);

  const setActiveProfile = useCallback((id: string) => {
    dispatch({ type: 'setActive', id });
  }, []);

  const value = useMemo<ProfileStore>(() => {
    const activeProfile =
      state.profiles.find((p) => p.id === state.activeProfileId) ?? null;
    return {
      profiles: state.profiles,
      activeProfileId: state.activeProfileId,
      activeProfile,
      addProfile,
      updateProfile,
      setProfileConfig,
      removeProfile,
      setActiveProfile,
    };
  }, [state, addProfile, updateProfile, setProfileConfig, removeProfile, setActiveProfile]);

  return (
    <ProfileStoreContext.Provider value={value}>
      {children}
    </ProfileStoreContext.Provider>
  );
}

export function useProfileStore(): ProfileStore {
  const ctx = useContext(ProfileStoreContext);
  if (!ctx) {
    throw new Error('useProfileStore must be used within <ProfileStoreProvider>');
  }
  return ctx;
}

// --- validation -------------------------------------------------------------

export type DraftErrors = { name?: string; gatewayUrl?: string };

export function validateDraft(draft: ProfileDraft): DraftErrors {
  const errors: DraftErrors = {};

  const name = draft.name.trim();
  if (!name) {
    errors.name = 'Name is required.';
  } else if (name.length > 60) {
    errors.name = 'Keep the name under 60 characters.';
  }

  const raw = draft.gatewayUrl.trim();
  if (!raw) {
    errors.gatewayUrl = 'Gateway URL is required.';
  } else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(raw);
    } catch {
      parsed = null;
    }
    if (!parsed) {
      errors.gatewayUrl = 'Enter a valid URL, e.g. https://gateway.example.dev';
    } else if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      errors.gatewayUrl = 'URL must start with http:// or https://';
    } else if (!parsed.hostname) {
      errors.gatewayUrl = 'URL must include a host.';
    }
  }

  return errors;
}

export function hasErrors(errors: DraftErrors): boolean {
  return Boolean(errors.name || errors.gatewayUrl);
}

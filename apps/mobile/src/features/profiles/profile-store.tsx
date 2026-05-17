/**
 * In-memory connection-profile store (Phase-1 profiles slice).
 *
 * PLAN-02 model: a profile is `{ id; name; gatewayUrl; wsUrl? }`. The user
 * enters ONLY `name` + `gatewayUrl`; `wsUrl` is discovered later from the
 * gateway's `GET /config` (NOT asked for here). Exactly one profile is active.
 *
 * Persistence is intentionally deferred: `@react-native-async-storage/async-storage`
 * is not installed and secure-store/file-system are out of scope for this slice,
 * so state lives in React state/context only. The public API (add/update/remove/
 * setActive + selectors) is shaped so a persistence backend can be slotted behind
 * it later with zero screen changes.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
} from 'react';

export type Profile = {
  id: string;
  name: string;
  gatewayUrl: string;
  /** Discovered later from the gateway (GET /config) — never user-entered. */
  wsUrl?: string;
};

/** Fields the user actually edits in the UI. */
export type ProfileDraft = { name: string; gatewayUrl: string };

type State = {
  profiles: Profile[];
  activeProfileId: string | null;
};

type Action =
  | { type: 'add'; profile: Profile }
  | { type: 'update'; id: string; draft: ProfileDraft }
  | { type: 'remove'; id: string }
  | { type: 'setActive'; id: string };

let _seq = 0;
/** Stable enough for an in-memory store (no `expo-crypto` dep pulled in here). */
function makeId(): string {
  _seq += 1;
  return `p_${Date.now().toString(36)}_${_seq.toString(36)}`;
}

const SEED: State = (() => {
  const seed: Profile = {
    id: makeId(),
    name: 'Local mock',
    gatewayUrl: 'mock://local',
  };
  return { profiles: [seed], activeProfileId: seed.id };
})();

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'add': {
      const profiles = [...state.profiles, action.profile];
      // First profile added to an empty store becomes active automatically.
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
              // gatewayUrl changed → any previously discovered wsUrl is stale.
              wsUrl:
                p.gatewayUrl.trim() === action.draft.gatewayUrl.trim()
                  ? p.wsUrl
                  : undefined,
            }
          : p,
      );
      return { ...state, profiles };
    }
    case 'remove': {
      const profiles = state.profiles.filter((p) => p.id !== action.id);
      let activeProfileId = state.activeProfileId;
      if (activeProfileId === action.id) {
        // Active profile deleted → fall back to the first remaining one.
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
  removeProfile: (id: string) => void;
  setActiveProfile: (id: string) => void;
};

const ProfileStoreContext = createContext<ProfileStore | null>(null);

export function ProfileStoreProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, dispatch] = useReducer(reducer, SEED);

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
      removeProfile,
      setActiveProfile,
    };
  }, [state, addProfile, updateProfile, removeProfile, setActiveProfile]);

  return (
    <ProfileStoreContext.Provider value={value}>
      {children}
    </ProfileStoreContext.Provider>
  );
}

/**
 * Access the profile store. The provider is mounted locally by `SettingsScreen`
 * so the slice stays self-contained (no edits to frozen `src/app`/`src/data`).
 */
export function useProfileStore(): ProfileStore {
  const ctx = useContext(ProfileStoreContext);
  if (!ctx) {
    throw new Error('useProfileStore must be used within <ProfileStoreProvider>');
  }
  return ctx;
}

// --- validation -------------------------------------------------------------

export type DraftErrors = { name?: string; gatewayUrl?: string };

/**
 * Validate the user-entered draft. Only `name` + `gatewayUrl` are user-owned.
 * URL rules are deliberately lenient-but-real: must parse as a URL with an
 * http(s) scheme and a host (the gateway is an HTTP origin per PLAN-02; `wsUrl`
 * is derived server-side, never typed here).
 */
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

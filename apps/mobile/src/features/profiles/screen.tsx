/**
 * Phase-1 slice: profiles / connection settings.
 *
 * PLAN-02 model: `Profile = { id; name; gatewayUrl; wsUrl? }`. The user enters
 * ONLY `name` + `gatewayUrl`; `wsUrl` is discovered later from the gateway.
 * Multiple profiles, exactly one active; switching active is a core action.
 *
 * Constraints: only `@/ui` primitives + `@/constants/theme` + core RN. State is
 * in-memory (no AsyncStorage / secure-store — persistence deferred per slice
 * brief). The provider is mounted here so the slice stays self-contained and
 * `src/app` / `src/data` stay frozen. Light + dark via `useThemeColors`.
 */
import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Spacing } from '@/constants/theme';
import {
  AppBar,
  Badge,
  Button,
  EmptyState,
  ListItem,
  Screen,
  Section,
  useThemeColors,
} from '@/ui';

import { ProfileForm } from './ProfileForm';
import {
  type Profile,
  type ProfileDraft,
  useProfileStore,
} from './profile-store';

const ACCENT = '#208AEF';

type Pane =
  | { kind: 'list' }
  | { kind: 'add' }
  | { kind: 'edit'; id: string };

// --- list ------------------------------------------------------------------

function ProfileRow({
  profile,
  active,
  last,
  onPress,
}: {
  profile: Profile;
  active: boolean;
  last: boolean;
  onPress: () => void;
}) {
  const c = useThemeColors();
  return (
    <ListItem
      title={profile.name}
      subtitle={profile.gatewayUrl}
      last={last}
      onPress={onPress}
      trailing={
        <View style={styles.trailing}>
          {active ? (
            <Badge text="Active" tone="good" />
          ) : (
            <Text style={[styles.setActiveHint, { color: ACCENT }]}>Set active</Text>
          )}
          <Text style={[styles.chevron, { color: c.textSecondary }]}>{'›'}</Text>
        </View>
      }
    />
  );
}

function ConnectionsList({
  onAdd,
  onOpen,
  onSignIn,
}: {
  onAdd: () => void;
  onOpen: (id: string) => void;
  onSignIn: () => void;
}) {
  const c = useThemeColors();
  const { profiles, activeProfileId, activeProfile, setActiveProfile } =
    useProfileStore();

  return (
    <Screen scroll>
      <AppBar title="Settings" />

      {profiles.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            title="No connections yet"
            hint="Open-Inspect is self-hosted — add the gateway URL for your deployment to get started."
          />
          <Button title="Add connection" onPress={onAdd} />
        </View>
      ) : (
        <>
          <Section title="Connections">
            {profiles.map((p, i) => (
              <ProfileRow
                key={p.id}
                profile={p}
                active={p.id === activeProfileId}
                last={i === profiles.length - 1}
                onPress={() =>
                  p.id === activeProfileId
                    ? onOpen(p.id)
                    : setActiveProfile(p.id)
                }
              />
            ))}
          </Section>

          <Text style={[styles.footnote, { color: c.textSecondary }]}>
            Tap a connection to make it active. Tap again, or the chevron, to
            edit or remove it. Each connection keeps its own sign-in.
          </Text>

          <Button title="Add connection" onPress={onAdd} />

          <Section title="Account">
            <ListItem
              title="Sign in"
              subtitle={
                activeProfile
                  ? `Authenticate with ${activeProfile.name}`
                  : 'Add a connection first'
              }
              onPress={onSignIn}
              last
              trailing={
                <Text style={[styles.chevron, { color: c.textSecondary }]}>
                  {'›'}
                </Text>
              }
            />
          </Section>
        </>
      )}
    </Screen>
  );
}

// --- add -------------------------------------------------------------------

function AddConnection({ onDone }: { onDone: () => void }) {
  const { addProfile, setProfileConfig } = useProfileStore();
  const [fetching, setFetching] = React.useState(false);

  const handleSubmit = async (draft: ProfileDraft) => {
    const profile = addProfile(draft);
    setFetching(true);
    try {
      const url = draft.gatewayUrl.trim().replace(/\/$/, '');
      const res = await fetch(`${url}/config`, {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = (await res.json()) as { wsUrl?: string; githubOAuthClientId?: string };
        if (data.wsUrl && data.githubOAuthClientId) {
          setProfileConfig(profile.id, {
            wsUrl: data.wsUrl,
            githubOAuthClientId: data.githubOAuthClientId,
          });
        }
      }
    } catch {
      // ignore — non-fatal, user can retry later
    } finally {
      setFetching(false);
      onDone();
    }
  };

  return (
    <Screen scroll>
      <AppBar title="Add connection" />
      <ProfileForm
        mode="add"
        submitLabel={fetching ? 'Discovering…' : 'Save connection'}
        onSubmit={handleSubmit}
        onCancel={onDone}
      />
    </Screen>
  );
}

// --- edit / delete ---------------------------------------------------------

function EditConnection({
  id,
  onDone,
}: {
  id: string;
  onDone: () => void;
}) {
  const c = useThemeColors();
  const {
    profiles,
    activeProfileId,
    updateProfile,
    removeProfile,
    setActiveProfile,
  } = useProfileStore();

  const profile = profiles.find((p) => p.id === id);

  // Profile vanished (e.g. removed elsewhere) — bail back to the list.
  if (!profile) {
    return (
      <Screen scroll>
        <AppBar title="Connection" />
        <View style={styles.emptyWrap}>
          <EmptyState title="Connection not found" hint="It may have been removed." />
          <Button title="Back to connections" onPress={onDone} />
        </View>
      </Screen>
    );
  }

  const isActive = profile.id === activeProfileId;

  const confirmDelete = () => {
    Alert.alert(
      'Remove connection',
      `Remove “${profile.name}”? This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeProfile(profile.id);
            onDone();
          },
        },
      ],
    );
  };

  return (
    <Screen scroll>
      <AppBar title="Edit connection" />

      <Section title="Status">
        <ListItem
          title={profile.name}
          subtitle={profile.wsUrl ? `ws: ${profile.wsUrl}` : 'websocket not yet discovered'}
          last={isActive}
          trailing={
            isActive ? (
              <Badge text="Active" tone="good" />
            ) : (
              <Text style={[styles.setActiveHint, { color: ACCENT }]}>Tap to activate</Text>
            )
          }
          onPress={isActive ? undefined : () => setActiveProfile(profile.id)}
        />
        {!isActive ? (
          <ListItem
            title="Make active"
            subtitle="Use this connection for the app"
            last
            onPress={() => setActiveProfile(profile.id)}
            trailing={<Text style={[styles.chevron, { color: c.textSecondary }]}>{'›'}</Text>}
          />
        ) : null}
      </Section>

      <ProfileForm
        mode="edit"
        initial={{ name: profile.name, gatewayUrl: profile.gatewayUrl }}
        submitLabel="Save changes"
        onSubmit={(draft) => {
          updateProfile(profile.id, draft);
          onDone();
        }}
        onCancel={onDone}
      />

      <View style={styles.dangerZone}>
        <Button title="Remove connection" variant="destructive" onPress={confirmDelete} />
      </View>
    </Screen>
  );
}

// --- screen root -----------------------------------------------------------

function SettingsScreenInner() {
  const router = useRouter();
  const [pane, setPane] = useState<Pane>({ kind: 'list' });

  const goSignIn = () => router.push('/sign-in');
  const goList = () => setPane({ kind: 'list' });

  switch (pane.kind) {
    case 'add':
      return <AddConnection onDone={goList} />;
    case 'edit':
      return <EditConnection id={pane.id} onDone={goList} />;
    case 'list':
    default:
      return (
        <ConnectionsList
          onAdd={() => setPane({ kind: 'add' })}
          onOpen={(id) => setPane({ kind: 'edit', id })}
          onSignIn={goSignIn}
        />
      );
  }
}

export function SettingsScreen() {
  return <SettingsScreenInner />;
}

const styles = StyleSheet.create({
  trailing: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  chevron: { fontSize: 20, fontWeight: '400' },
  setActiveHint: { fontSize: 14, fontWeight: '600' },
  footnote: {
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  emptyWrap: { flexGrow: 1, justifyContent: 'center' },
  dangerZone: { marginTop: Spacing.five },
});

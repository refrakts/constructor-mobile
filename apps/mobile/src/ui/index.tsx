/**
 * UI wrapper (PLAN-02). Primary surface = these plain-RN, native-iOS-styled
 * primitives — they render in Expo Go. `@expo/ui` (SwiftUI) ships native code
 * and CRASHES Expo Go if statically imported, so it is lazy-required behind a
 * guard and exposed only as an opt-in enhancement for dev/standalone builds.
 * Phase-1 screens MUST use these primitives, never import `@expo/ui` directly.
 */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useColorScheme,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';

import { Colors, Fonts, Spacing } from '@/constants/theme';

export type Palette = Record<keyof typeof Colors.light, string>;

export function useThemeColors(): Palette {
  return (useColorScheme() === 'dark' ? Colors.dark : Colors.light) as Palette;
}

// --- @expo/ui capability shim ---------------------------------------------
export const isExpoGo = Constants.appOwnership === 'expo';
let _swiftUI: typeof import('@expo/ui/swift-ui') | null = null;
if (!isExpoGo) {
  try {
    _swiftUI = require('@expo/ui/swift-ui');
  } catch {
    _swiftUI = null;
  }
}
/** Opt-in SwiftUI surface. `available` is false in Expo Go — always branch on it. */
export const nativeUI = { available: !!_swiftUI, swiftUI: _swiftUI } as const;

// --- primitives ------------------------------------------------------------
export function Screen({
  children,
  scroll,
}: {
  children: React.ReactNode;
  scroll?: boolean;
}) {
  const c = useThemeColors();
  const Body: React.ElementType = scroll ? ScrollView : View;
  return (
    <SafeAreaView style={[s.flex, { backgroundColor: c.background }]} edges={['top']}>
      <Body style={s.flex} contentContainerStyle={scroll ? s.scrollPad : undefined}>
        {children}
      </Body>
    </SafeAreaView>
  );
}

export function AppBar({ title, right }: { title: string; right?: React.ReactNode }) {
  const c = useThemeColors();
  return (
    <View style={[s.appbar, { borderBottomColor: c.backgroundSelected }]}>
      <Text style={[s.appbarTitle, { color: c.text }]} numberOfLines={1}>
        {title}
      </Text>
      {right}
    </View>
  );
}

export function Section({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  const c = useThemeColors();
  return (
    <View style={s.section}>
      {title ? (
        <Text style={[s.sectionTitle, { color: c.textSecondary }]}>{title.toUpperCase()}</Text>
      ) : null}
      <View style={[s.card, { backgroundColor: c.backgroundElement }]}>{children}</View>
    </View>
  );
}

export function Row({
  children,
  onPress,
  last,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const c = useThemeColors();
  const inner = (
    <View style={[s.row, !last && { borderBottomColor: c.backgroundSelected, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      {children}
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} android_ripple={{ color: c.backgroundSelected }}>
      {inner}
    </Pressable>
  ) : (
    inner
  );
}

export function ListItem({
  title,
  subtitle,
  trailing,
  onPress,
  last,
}: {
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const c = useThemeColors();
  return (
    <Row onPress={onPress} last={last}>
      <View style={s.flex}>
        <Text style={[s.itemTitle, { color: c.text }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[s.itemSub, { color: c.textSecondary }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Row>
  );
}

export function TextField(props: TextInputProps & { label?: string }) {
  const c = useThemeColors();
  const { label, style, ...rest } = props;
  return (
    <View style={s.field}>
      {label ? <Text style={[s.label, { color: c.textSecondary }]}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={c.textSecondary}
        style={[s.input, { color: c.text, backgroundColor: c.backgroundElement }, style]}
        {...rest}
      />
    </View>
  );
}

export function Toggle({ value, onValueChange }: { value: boolean; onValueChange: (v: boolean) => void }) {
  return <Switch value={value} onValueChange={onValueChange} />;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'destructive';
  disabled?: boolean;
}) {
  const c = useThemeColors();
  const bg =
    variant === 'primary' ? '#208AEF' : variant === 'destructive' ? '#E5484D' : 'transparent';
  const fg = variant === 'ghost' ? '#208AEF' : '#ffffff';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[s.btn, { backgroundColor: bg, opacity: disabled ? 0.4 : 1 }, variant === 'ghost' && s.btnGhost]}
    >
      <Text style={[s.btnText, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function Separator() {
  const c = useThemeColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.backgroundSelected }} />;
}

export function Badge({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const map = { neutral: '#8E8E93', good: '#30A46C', warn: '#F5A623', bad: '#E5484D' };
  return (
    <View style={[s.badge, { backgroundColor: map[tone] + '22', borderColor: map[tone] }]}>
      <Text style={[s.badgeText, { color: map[tone] }]}>{text}</Text>
    </View>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  const c = useThemeColors();
  return (
    <View style={s.empty}>
      <Text style={[s.emptyTitle, { color: c.text }]}>{title}</Text>
      {hint ? <Text style={[s.itemSub, { color: c.textSecondary }]}>{hint}</Text> : null}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const c = useThemeColors();
  return (
    <View style={s.empty}>
      <ActivityIndicator />
      {label ? <Text style={[s.itemSub, { color: c.textSecondary, marginTop: Spacing.three }]}>{label}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  scrollPad: { paddingBottom: Spacing.six },
  appbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  appbarTitle: { fontSize: 20, fontWeight: '700', fontFamily: Fonts.sans, flex: 1 },
  section: { paddingHorizontal: Spacing.three, paddingTop: Spacing.four },
  sectionTitle: { fontSize: 12, fontWeight: '600', marginBottom: Spacing.two, marginLeft: Spacing.two },
  card: { borderRadius: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, gap: Spacing.three },
  itemTitle: { fontSize: 16, fontWeight: '500', fontFamily: Fonts.sans },
  itemSub: { fontSize: 13, marginTop: 2, fontFamily: Fonts.sans },
  field: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  label: { fontSize: 13, marginBottom: Spacing.two, marginLeft: Spacing.two },
  input: { borderRadius: 10, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, fontSize: 16, fontFamily: Fonts.sans },
  btn: { borderRadius: 12, paddingVertical: Spacing.three, alignItems: 'center', marginHorizontal: Spacing.three, marginTop: Spacing.four },
  btnGhost: { borderWidth: StyleSheet.hairlineWidth, borderColor: '#208AEF' },
  btnText: { fontSize: 16, fontWeight: '600', fontFamily: Fonts.sans },
  badge: { borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '600' },
  empty: { alignItems: 'center', justifyContent: 'center', padding: Spacing.six, gap: Spacing.two, flexGrow: 1 },
  emptyTitle: { fontSize: 17, fontWeight: '600', fontFamily: Fonts.sans },
});

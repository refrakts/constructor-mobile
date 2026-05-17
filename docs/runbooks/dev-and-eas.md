# Runbook — Running the app, dev builds, and EAS Update

Branch `build/mobile-ui`. Mobile app: `apps/mobile` (Expo SDK 55, pnpm monorepo).

---

## 1. See it now — Expo Go (no Apple/EAS account needed)

```bash
cd apps/mobile
pnpm start            # add --tunnel if phone and Mac aren't on the same Wi-Fi
```

- Install **Expo Go** from the App Store on the iPhone.
- iPhone **Camera** → point at the QR in the terminal → opens in Expo Go.
- You get the full app on **mock data** (no backend): sign-in → sessions → create → live stream, settings/profiles.
- **Caveat:** `@expo/ui` renders native SwiftUI and **does not run in Expo Go** — the app uses the polished plain-RN fallback there. The SwiftUI chrome only appears in a dev build (§2).
- Connection profiles persist on-device (expo-sqlite/kv-store) across reloads.

## 2. Dev build — full native look (needs your Apple + EAS auth)

A dev build is required because the app uses native modules (`@expo/ui`, `@shopify/flash-list` v2, `expo-sqlite`, `expo-updates`). One-time:

```bash
cd apps/mobile
npx eas login                       # your Expo account (owner: refrakts)
npx eas build --profile development --platform ios
```

- EAS handles iOS signing; follow prompts for the Apple Developer account (the $99/yr account is the one unavoidable Apple cost noted in PLAN-05).
- When the build finishes, EAS shows a QR / install link → install on the device (UDID must be registered; EAS walks you through it for `distribution: internal`).
- Run the JS for it: `pnpm start` (the dev build replaces Expo Go and renders the SwiftUI chrome).
- **Speed tip:** enable EAS **Remote Build Cache** in `app.json` so JS-only changes don't trigger a native rebuild (see Expo docs — fingerprint-matched prebuilt binaries).

## 3. EAS Update (OTA) — ship JS without a rebuild

Provisioned in this repo: `app.json` has `runtimeVersion.policy = "fingerprint"` and `updates.url`; `apps/mobile/eas.json` defines channels.

| Channel | Branch | Use |
|---|---|---|
| `development` | `development` | push JS to a teammate's/your installed **dev build** without rebuilding |
| `preview` | `preview` | internal pre-release verification |
| `production` | `production` | App Store builds; staged rollouts live here |

Publish an update:

```bash
cd apps/mobile
npx eas update --branch development --environment development -m "message"
```

- **SDK 55 gotcha:** `eas update` **requires `--environment`** (`development|preview|production`) or it errors.
- **fingerprint policy:** any *native* change (new/upgraded native module) bumps the runtime fingerprint → a stale build will **not** load incompatible JS (correct, by design); you must make a new dev/store build. Pure-JS changes (screens, copy, protocol tweaks) ship instantly via `eas update`. Expect frequent fingerprint bumps through M1–M2 (`@expo/ui` is alpha) — OTA value rises at M3+ once native chrome stabilizes.
- **Local iteration stays `pnpm start`** (Metro) — that's faster than OTA. OTA is specifically for updating an *already-installed* build without a rebuild.

### Staged rollout / rollback (M5 hardening)

```bash
npx eas update --branch production --environment production --rollout-percentage 10 -m "..."
npx eas update:edit                         # widen the rollout
npx eas update:revert-update-rollout        # abort: republish previous to restore clients
```

- One active rollout per branch/channel at a time — you cannot publish a new update mid-rollout.
- Code signing (`--private-key-path`) is optional; reasonable to defer given the single-tenant trust model (revisit in M5).

## 4. Notes / deferred

- **Backend is gated:** the live data path (M0 contract spike, real gateway/WS) is deferred until `ColeMurray/background-agents@a7b968f` is deployed. The app runs entirely on the mock gateway until then.
- The `development` channel was added to `eas.json` by hand (`eas update:configure` only sets `preview`/`production`).
- First `eas update:configure`/`eas login`/build steps require your Expo + Apple auth and were intentionally left for you — the durable config is already committed so the first dev build participates in OTA.

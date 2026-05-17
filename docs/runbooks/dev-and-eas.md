# Runbook — Running, TestFlight, and OTA updates

Branch `build/mobile-ui`. Mobile app: `apps/mobile` (Expo SDK 55, pnpm monorepo).
Bundle ID: `dev.nejc.constructor` (in `app.json`). EAS project owner: `refrakts`.

---

## 1. Quick look — Expo Go (no account needed)

```bash
cd apps/mobile && pnpm start         # add --tunnel if phone/Mac not on same Wi-Fi
```
Expo Go (App Store) → scan QR. Mock data; plain-RN UI (`@expo/ui` SwiftUI does not render in Expo Go). Profiles persist via expo-sqlite/kv-store.

## 2. TestFlight (the chosen distribution) + OTA

A TestFlight build is a **release/store build**: it runs the *embedded* JS bundle (no Metro / no `pnpm start`) and receives JS changes via **OTA** (`expo-updates`, already provisioned).

**Prerequisites**
- Apple Developer Program — active (✓ renews 2026-10-24).
- `eas login` with an Expo account that has access to `owner: "refrakts"`. If not: join that Expo org, or `npx eas-cli@latest init` to re-create the project under your account (then update `app.json` → `updates.url` to `https://u.expo.dev/<new-projectId>`).
- **Confirm the bundle identifier** `dev.nejc.constructor` *before the first submit* — it is permanent in App Store Connect. Change in `app.json` → `ios.bundleIdentifier` if you want something else.

**Build → submit (run from `apps/mobile`)**
```bash
cd apps/mobile
npx eas-cli@latest login
npx eas-cli@latest build --profile production --platform ios     # store-signed; build number auto-increments (remote)
npx eas-cli@latest submit --profile production --platform ios     # uploads to App Store Connect → TestFlight
```
- At the build prompt choose **"Let EAS manage credentials."**
- `eas submit` will offer to **create the App Store Connect app record** if it doesn't exist (needs your Apple login or an ASC API key — EAS walks you through it). It does **not** publish to the public App Store; it only puts the build in TestFlight.
- Apple processes the build (~5–15 min). Then in **App Store Connect → TestFlight**: add **Internal Testers** (up to 100, immediate, no review) or External Testers (first build needs a ~1‑day beta review).
- Monorepo is handled: run from `apps/mobile`; EAS uploads the git repo from root (so `packages/protocol` is included, `.upstream/` is gitignored and not uploaded) and uses the pinned pnpm (`packageManager` in root `package.json`).

> The expo.dev "Create your first build" wizard just means no builds exist yet — the CLI above is the path; ignore the website wizard.

### Optional: faster local iteration (dev client)
For day-to-day dev you don't want a TestFlight round-trip. Build the dev client once and use Metro:
```bash
npx eas-cli@latest device:create                                  # register your iPhone (one-time)
npx eas-cli@latest build --profile development --platform ios      # dev client
# install via the QR, then:
cd apps/mobile && pnpm start                                       # JS over Metro, full SwiftUI on device
```

## 3. OTA updates — works on TestFlight (and dev/internal) builds

Provisioned: `app.json` has `runtimeVersion.policy = "fingerprint"` + `updates.url`; `eas.json` build profiles carry a `channel`. The `production` profile (TestFlight) embeds channel **`production`**.

Push a JS/asset change to all TestFlight testers **without a new build**:
```bash
cd apps/mobile
npx eas-cli@latest update --branch production --environment production -m "what changed"
```
- First time, link channel→branch if not auto: `npx eas-cli@latest channel:edit production --branch production`.
- Testers receive it on the **next cold launch** (expo-updates downloads in the background and applies on the following launch — Apple permits this for TestFlight/App Store).
- **`--environment` is required on SDK 55** or `eas update` errors.
- **Fingerprint caveat (the rule that matters):** OTA only covers JS/asset changes. Any *native* change (new/upgraded native module, app config affecting native) bumps the runtime fingerprint → existing TestFlight builds will **not** pick it up; you must `eas build` + `eas submit` a new TestFlight build. Expect frequent fingerprint bumps through M1–M2 (`@expo/ui` alpha); OTA value rises at M3+ once native deps settle.

### Staged rollout / rollback (M5)
```bash
npx eas-cli@latest update --branch production --environment production --rollout-percentage 10 -m "..."
npx eas-cli@latest update:edit                       # widen
npx eas-cli@latest update:revert-update-rollout      # abort: republish previous
```
One active rollout per branch/channel at a time. Code signing for updates (`--private-key-path`) is optional — reasonable to defer (single-tenant trust model; revisit M5).

## 4. Notes / deferred

- **Backend is gated:** live data path (M0 contract spike, real gateway/WS) deferred until `ColeMurray/background-agents@a7b968f` is deployed. App runs entirely on the mock gateway until then — TestFlight testers see the mock UX.
- Promote TestFlight → public App Store later = a button in App Store Connect, **no rebuild** (out of scope per your "not actual appstore").
- The `development` channel was added to `eas.json` by hand (`eas update:configure` only sets `preview`/`production`).
- Speed tip: enable EAS **Remote Build Cache** in `app.json` so JS-only changes don't force a native rebuild (fingerprint-matched prebuilt binaries — see Expo docs).

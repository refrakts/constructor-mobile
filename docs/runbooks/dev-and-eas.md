# Runbook — Running, TestFlight, OTA, Metadata

Branch `build/mobile-ui`. App: `apps/mobile` (Expo SDK 55, pnpm monorepo).
Bundle ID: `dev.nejc.constructor`. EAS owner: **your personal Expo account**.
Runtime version policy: **`appVersion`** (tied to `expo.version`; see §4 for why).

---

## 1. Quick look — Expo Go (mock preview only)

```bash
cd apps/mobile && pnpm start          # --tunnel if phone/Mac not on same Wi-Fi
```
Throwaway preview, never the deliverable: Expo Go is a precompiled sandbox — ignores
most of `app.json`, can't run custom native code (`@expo/ui` SwiftUI doesn't render),
doesn't reflect production. The real artifact is the TestFlight build (§3). Mock data;
profiles persist via expo-sqlite/kv-store.

## 2. First-time EAS setup (personal account)

`app.json` doesn't pin `owner`/`projectId`/`updates.url` (they were the `refrakts`
project's). Create the project under your account:

```bash
cd apps/mobile
npx eas-cli@latest login                 # your personal Expo account
npx eas-cli@latest init                   # new project under your account; writes extra.eas.projectId (+ owner)
npx eas-cli@latest update:configure       # adds updates.url for the new project
                                          # (leaves runtimeVersion: appVersion as-is)
```
Then **commit the regenerated `app.json`** (`projectId`/`updates.url` are not secrets).

## 3. TestFlight (release build, not public App Store)

A TestFlight build is a **store/release build**: it runs the *embedded* JS bundle
(no Metro / no `pnpm start`) and is updated via OTA (§4). Apple account active;
`infoPlist.ITSAppUsesNonExemptEncryption=false` auto-answers export compliance.

```bash
cd apps/mobile
npx eas-cli@latest build  --profile production --platform ios   # store-signed; build # auto-increments
npx eas-cli@latest submit --profile production --platform ios   # → App Store Connect → TestFlight
```
- Choose **"Let EAS manage credentials."** `eas submit` offers to **create the App
  Store Connect app record** if missing — expected; it does **not** publish to the
  public App Store (TestFlight only).
- Apple processes ~5–15 min → **App Store Connect → TestFlight** → add **Internal
  Testers** (≤100, immediate, no review) / External (first build ~1-day review).
- Monorepo handled: run from `apps/mobile`; EAS uploads the git repo from root
  (`packages/protocol` included, `.upstream/` gitignored/not uploaded), pinned pnpm
  via root `packageManager`.

### Optional: dev client for fast local iteration
```bash
npx eas-cli@latest device:create                                # register iPhone (one-time)
npx eas-cli@latest build --profile development --platform ios    # dev client
# install via QR, then: cd apps/mobile && pnpm start             # JS over Metro, full SwiftUI
```

## 4. OTA updates — `appVersion` policy

`runtimeVersion.policy = "appVersion"` → **runtimeVersion = `expo.version`** (today
`1.0.0`). It is embedded in every build (TestFlight, dev, internal). Push JS/asset
changes with **no new build**:

```bash
cd apps/mobile
npx eas-cli@latest update --branch production --environment production -m "what changed"
# first time, if not auto-linked: eas channel:edit production --branch production
```
- Testers get it on the **next cold launch** (downloads in background, applies next
  launch — Apple permits this for TestFlight/App Store).
- **`--environment` is required on SDK 55** or it errors.
- **Native-change rule (replaces the old fingerprint auto-detect):** an OTA update
  only reaches builds with the **same `expo.version`**. When you make a *native*
  change (new/upgraded native module, native config), bump `expo.version`
  (`1.0.0` → `1.0.1`) **and** ship a new TestFlight build. JS/asset-only changes ship
  via `eas update` to the current version with no rebuild. Discipline is manual but
  explicit; you rebuild for native changes anyway.
- Rollout/rollback (M5): `--rollout-percentage`, `update:edit`,
  `update:revert-update-rollout`. One active rollout per branch/channel.

> **Why not the `fingerprint` policy?** It was the original choice (auto-detects
> native changes) but it computes the runtime version *differently on macOS-local
> vs the EAS Linux builder* — EAS prebuild adds an `ios/` `bareNativeDir` and native
> autolinking dir hashes (reanimated/worklets/screens/safe-area-context) differ
> across environments — which **failed every build** with a "Runtime version
> mismatch" in pnpm-monorepo + CNG. `appVersion` is deterministic, keeps managed/CNG,
> and still fully supports OTA. (Revisit fingerprint only if Expo improves
> cross-environment determinism for pnpm monorepos.)

## 5. EAS Metadata (optional — App Store listing as code)

`eas metadata` manages **App Store Connect listing metadata** via `store.config.json`
(iOS only). **Not needed for internal TestFlight**; matters for *external* TestFlight
(beta review) and a future App Store. After the first `eas submit` creates the ASC
app: `eas metadata:pull` (scaffolds a schema-correct `store.config.json` — listing
text only, **no secrets, safe to commit**) → edit → `eas metadata:push`. Don't
hand-author it. Re-`pull` after dashboard edits to avoid overwrites.

## 6. Credentials & gitignore

**Nothing leaks by default.** EAS-managed (remote) credentials — the default we use —
keep the APNs push key, distribution cert, and provisioning profile **on Expo's
servers, not in this repo**; `eas build` writes no secrets to the tree.
`apps/mobile/.gitignore` already ignores `*.p8 *.p12 *.mobileprovision *.key *.pem
*.jks` and `/ios /android`; `credentials.json` is added defensively (only present if
you opt into *local* credentials). No action needed.

## 7. EAS Insights (usage analytics)

`expo-insights` is installed. After a build it auto-reports app **cold-start
usage** (over time, by platform, by app-store version) to the Expo dashboard —
no code, no `app.json`/plugin change (autolinked on SDK 55), no secrets. View at
expo.dev → project `mobile` → **Insights**. Free preview.

**Requires a native build — NOT OTA-able.** It activates only in a fresh
`eas build --profile production` + `eas submit`; an `eas update` will not enable
it. Bundle it with your next rebuild.

## 8. Notes / deferred

- **Backend gated:** live data (M0, real gateway/WS) deferred until
  `ColeMurray/background-agents@a7b968f` is deployed — TestFlight testers see mock UX.
- TestFlight → public App Store later = a button in App Store Connect, no rebuild.
- Speed tip: EAS **Remote Build Cache** in `app.json` avoids native rebuilds for
  JS-only changes.

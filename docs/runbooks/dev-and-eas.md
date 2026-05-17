# Runbook — Running, TestFlight, OTA, Metadata

Branch `build/mobile-ui`. App: `apps/mobile` (Expo SDK 55, pnpm monorepo).
Bundle ID: `dev.nejc.constructor`. EAS owner: **your personal Expo account** (the
old `refrakts` owner/projectId were removed — see §2).

---

## 1. Quick look — Expo Go (mock preview only)

```bash
cd apps/mobile && pnpm start          # --tunnel if phone/Mac not on same Wi-Fi
```
Expo Go → scan QR. **This is a throwaway preview, never the deliverable:** Expo Go is
a precompiled sandbox — it ignores most of `app.json`, can't run custom native code
(`@expo/ui` SwiftUI doesn't render), and doesn't reflect production. The real artifact
is the TestFlight build (§3). Mock data; profiles persist via expo-sqlite/kv-store.

## 2. First-time EAS setup (personal account)

`app.json` no longer pins `owner`/`projectId`/`updates.url` (they were the `refrakts`
project's). Create the project under your account:

```bash
cd apps/mobile
npx eas-cli@latest login                 # your personal Expo account
npx eas-cli@latest init                   # creates a NEW project under your account,
                                          # writes extra.eas.projectId (+ owner)
npx eas-cli@latest update:configure       # re-adds updates.url for the new project
                                          # (keep runtimeVersion: fingerprint)
```
After this, commit the regenerated `app.json` (`projectId`/`updates.url` are not
secrets).

## 3. TestFlight (release build, not public App Store)

A TestFlight build is a **store/release build**: it runs the *embedded* JS bundle
(no Metro / no `pnpm start`) and is updated via OTA (§4). Your Apple Developer
account is active; `infoPlist.ITSAppUsesNonExemptEncryption=false` is set so the
export-compliance question is auto-answered.

```bash
cd apps/mobile
npx eas-cli@latest build  --profile production --platform ios   # store-signed; build # auto-increments
npx eas-cli@latest submit --profile production --platform ios   # → App Store Connect → TestFlight
```
- Pick **"Let EAS manage credentials."** `eas submit` offers to **create the App
  Store Connect app record** if missing — that's expected; it does **not** publish
  to the public App Store (TestFlight only).
- Apple processes ~5–15 min → **App Store Connect → TestFlight** → add **Internal
  Testers** (≤100, immediate, no review) or External (first build ~1‑day review).
- Monorepo handled: run from `apps/mobile`; EAS uploads the git repo from root
  (`packages/protocol` included, `.upstream/` gitignored so not uploaded), pinned
  pnpm via root `packageManager`.

### Optional: dev client for fast local iteration
```bash
npx eas-cli@latest device:create                                # register iPhone (one-time)
npx eas-cli@latest build --profile development --platform ios    # dev client
# install via QR, then: cd apps/mobile && pnpm start             # JS over Metro, full SwiftUI
```

## 4. OTA updates — works on TestFlight builds

`runtimeVersion: fingerprint` + `updates.url` (set by §2) + the `production`
channel are embedded in the TestFlight build. Push JS/asset changes with **no new
build/upload**:

```bash
cd apps/mobile
npx eas-cli@latest update --branch production --environment production -m "what changed"
# first time, if not auto-linked: eas channel:edit production --branch production
```
- Testers get it on the **next cold launch** (downloads in background, applies next
  launch — Apple permits this for TestFlight/App Store).
- **`--environment` is required on SDK 55** or it errors.
- **Fingerprint caveat:** OTA only covers JS/asset changes. Any *native* change
  (new/upgraded native module, native config) bumps the fingerprint → existing
  TestFlight builds won't pick it up; rebuild + resubmit. Frequent through M1–M2
  (`@expo/ui` alpha); OTA value rises at M3+.
- Rollout/rollback (M5): `--rollout-percentage`, `update:edit`,
  `update:revert-update-rollout`. One active rollout per branch/channel.

## 5. EAS Metadata (optional — App Store listing as code)

`eas metadata` manages **App Store Connect listing metadata** (name, subtitle,
description, keywords, categories, review info) via a `store.config.json`. iOS only.

- **Not needed for internal TestFlight testing** — internal testers don't require a
  store listing. It matters for **external** TestFlight (beta review) and a future
  App Store submission.
- Recommended workflow (after the first `eas submit` creates the ASC app):
  ```bash
  npx eas-cli@latest metadata:pull     # scaffolds a schema-correct store.config.json from ASC
  # edit store.config.json
  npx eas-cli@latest metadata:push     # validates + pushes to App Store Connect
  ```
  Don't hand-author `store.config.json` (pull generates the correct schema). It
  contains only listing text — **no secrets — safe to commit**. Re-run
  `metadata:pull` after any dashboard edit to avoid overwrites.

## 6. Credentials & gitignore (your question)

**Nothing leaks by default.** With EAS-managed (remote) credentials — the default,
what we use — the APNs **push key**, distribution cert, and provisioning profile are
generated and stored **on Expo's servers, not in this repo**. `eas build`/`eas
credentials` write no secrets into the working tree.

Defensive coverage is already in place: `apps/mobile/.gitignore` ignores
`*.p8 *.p12 *.mobileprovision *.key *.pem *.jks` and `/ios /android`; I added
`credentials.json` (only ever present if you opt into *local* credentials). So:
**no action needed** — pushing/signing keys cannot be accidentally committed.

## 7. Notes / deferred

- **Backend gated:** live data (M0, real gateway/WS) deferred until
  `ColeMurray/background-agents@a7b968f` is deployed. TestFlight testers see the mock
  UX until then.
- TestFlight → public App Store later = a button in App Store Connect, no rebuild
  (out of scope per "not actual appstore").
- Speed tip: EAS **Remote Build Cache** in `app.json` avoids native rebuilds for
  JS-only changes (fingerprint-matched prebuilt binaries — see Expo docs).

# Runbook — Running the app, dev builds, and EAS Update

Branch `build/mobile-ui`. Mobile app: `apps/mobile` (Expo SDK 55, pnpm monorepo).

---

## 1. See it now — Expo Go (no Apple/EAS account needed)

```bash
cd apps/mobile
pnpm start            # add --tunnel if phone and Mac aren't on the same Wi-Fi
```

- Install **Expo Go** from the App Store; iPhone **Camera** → QR in terminal → opens in Expo Go.
- Full app on **mock data** (no backend). `@expo/ui` SwiftUI does **not** run in Expo Go — you get the polished plain-RN fallback. Connection profiles persist (expo-sqlite/kv-store).

## 2. iOS **device** dev build — full SwiftUI on your iPhone

This is the chosen path. A dev build is required because the app uses native modules (`@expo/ui`, FlashList v2, `expo-sqlite`, `expo-updates`).

**Prerequisites (gating):**

1. **Apple Developer Program** membership on your Apple ID ($99/yr, https://developer.apple.com/programs/). Enrollment can take ~24–48 h to approve — nothing below works until it's active.
2. **Expo account access to `owner: "refrakts"`** (set in `app.json`, projectId `00d6ac0f-2366-4d7e-843c-20cf79f4ea7d`). The account you `eas login` with must be a member of that Expo org. If not, either get added to the `refrakts` Expo org, **or** re-init under your own account:
   ```bash
   cd apps/mobile
   npx eas-cli@latest init          # creates a new projectId under your account; updates app.json owner + extra.eas.projectId
   ```
   If you re-init, also update `app.json` → `updates.url` to `https://u.expo.dev/<new-projectId>` (it currently points at the refrakts projectId).

**Steps (run from `apps/mobile`):**

```bash
cd apps/mobile
npx eas-cli@latest login                       # Expo account with access to `refrakts`
npx eas-cli@latest device:create               # register your iPhone: opens a URL/QR → install
                                               # the profile on the phone (Settings will prompt)
npx eas-cli@latest build --profile development --platform ios
```

- At the build prompt, choose **"Let EAS manage credentials"** — it logs into Apple, creates the distribution cert + a provisioning profile that includes the device you just registered. Don't hand-roll certs.
- Monorepo: run from `apps/mobile`. EAS uploads the git repo from the root (so `packages/protocol` is included; `.upstream/` is gitignored so it is **not** uploaded) and uses the pinned pnpm (`packageManager` in root `package.json`) — the workspace resolves correctly. No extra config.
- Remote build ≈ 10–20 min. When done, EAS shows a **QR / install link** → open it on the iPhone → install the dev client.
- First launch: if iOS blocks it, **Settings → General → VPN & Device Management** → trust the developer.
- Then load the JS: `cd apps/mobile && pnpm start` → open the installed **dev build** (not Expo Go). You now get the native `@expo/ui` SwiftUI chrome on the phone.

> The "Create your first build" message on expo.dev just means no builds exist yet — ignore the website wizard; the CLI sequence above is the path.

## 3. EAS Update (OTA) — ship JS without a rebuild

Provisioned: `app.json` has `runtimeVersion.policy = "fingerprint"` + `updates.url`; `apps/mobile/eas.json` defines channels.

| Channel | Branch | Use |
|---|---|---|
| `development` | `development` | push JS to your installed dev build, no rebuild |
| `preview` | `preview` | internal pre-release verification |
| `production` | `production` | App Store builds; staged rollouts |

```bash
cd apps/mobile
npx eas-cli@latest update --branch development --environment development -m "message"
```

- **SDK 55 gotcha:** `eas update` **requires `--environment`** or it errors.
- **fingerprint policy:** any native change (new/upgraded native module) bumps the fingerprint → a stale build will not load incompatible JS (correct) and you must rebuild. Pure-JS changes ship instantly. Expect frequent bumps through M1–M2 (`@expo/ui` is alpha); OTA value rises at M3+.
- Local iteration stays `pnpm start` (faster than OTA). OTA is for updating an *already-installed* build.

### Staged rollout / rollback (M5)

```bash
npx eas-cli@latest update --branch production --environment production --rollout-percentage 10 -m "..."
npx eas-cli@latest update:edit                       # widen
npx eas-cli@latest update:revert-update-rollout      # abort: republish previous
```

One active rollout per branch/channel at a time. Code signing (`--private-key-path`) optional — reasonable to defer given the single-tenant trust model (revisit M5).

## 4. Notes / deferred

- **Backend is gated:** the live data path (M0 contract spike, real gateway/WS) is deferred until `ColeMurray/background-agents@a7b968f` is deployed. The app runs entirely on the mock gateway until then.
- The `development` channel was added to `eas.json` by hand (`eas update:configure` only sets `preview`/`production`).
- **Speed tip:** enable EAS **Remote Build Cache** in `app.json` so JS-only changes don't trigger a native rebuild (fingerprint-matched prebuilt binaries — see Expo docs).

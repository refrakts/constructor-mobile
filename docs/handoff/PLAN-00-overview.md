# PLAN 00 — Mobile Client: Handoff Overview

> **Status:** architecture/handoff spec. Not built. Snippets are *validated sketches* — each
> points at the upstream file that is the source of truth. **Decisions committed** (user
> asked for best/most-standard — alternatives removed). Companion docs:
> [[PLAN-01-gateway]] [[PLAN-02-realtime-rn]] [[PLAN-03-push]] [[PLAN-04-protocol-pinning]]
> [[PLAN-05-config-and-risks]]. Evidence: [[FINAL-feasibility]],
> [[01-overview]]–[[07-gaps-and-blockers]].

## Goal

A native **Expo / React Native iOS app** with the web client's session control: start
sessions, live-stream agent output, follow-ups, history/resume, secrets & automations,
**push notifications** for background completion.

## Hard constraints

1. **Zero changes to `background-agents`.** All new code is in **one new repo**, separate
   from `background-agents`. Retained coupling = runtime protocol contract, managed via
   [[PLAN-04-protocol-pinning]].
2. **Native RN only — no WebView/iframe** anywhere in scope (incl. markdown).
3. **Configurable backends, never hardcoded.** App stores **connection profiles** (gateway
   URL + per-profile identity); user can add several and switch. The user enters *only* the
   gateway URL; everything else (`wsUrl`, …) is discovered from the gateway's `GET /config`
   at runtime. See [[PLAN-02-realtime-rn]] §Settings.
4. **In scope:** auth, session CRUD, live stream, follow-ups, stop, presence/multiplayer,
   history/resume, repo secrets, automations, screenshots, push.
5. **Out of scope:** ttyd terminal, code-server (inherently browser).

## Committed stack (best/most-standard — no alternatives)

| Concern | Decision | Note |
|---|---|---|
| Package manager | **pnpm only** (no npm) | supply-chain posture; one PM across the repo |
| Repo | **one pnpm monorepo** (`pnpm-workspace.yaml`: `apps/*`, `packages/*`) | separate from `background-agents` |
| Expo+pnpm | **`.npmrc` `node-linker=hoisted`** + Expo monorepo `metro.config.js` | required — pnpm's symlinked tree breaks Metro otherwise |
| App scaffold | `create-expo-app@latest` (default template) | TS + Expo Router |
| Navigation | **Expo Router** | Expo default |
| UI lib | **`@expo/ui`** (native SwiftUI) | per user pref; native iOS feel. **Experimental/alpha, partial coverage, SDK 52+/new arch** → chrome only; plain-RN fallback |
| Server cache | **TanStack Query** | standard for new RN apps (deliberate divergence from web's SWR) |
| Realtime state | local `useState`/`useRef` in ported socket hook | mirrors web |
| Auth | **`expo-auth-session` + `expo-web-browser`** | RFC 8252 standard native OAuth |
| GitHub app | **separate mobile GitHub OAuth App** | independent secret/revocation |
| Token storage | **`expo-secure-store`** (Keychain) | standard |
| Stream list | **`@shopify/flash-list`** + `maintainVisibleContentPosition` | high-volume token stream (not `@expo/ui`) |
| Agent content | **`react-native-markdown-display`** | not `@expo/ui` |
| Push | **Expo Push + gateway cron-poll** | free, no cost side-effect ([[PLAN-03-push]]) |
| Gateway | **Cloudflare Worker** (C3), **`jose`**, **KV** store | public-URL+HMAC |
| CP transport | **public URL + HMAC** (not service binding) | zero upstream coupling |

## Architecture in one picture

```
            (your pnpm monorepo: apps/mobile + apps/gateway)    (background-agents — UNCHANGED)
┌───────────────┐ OAuth  ┌────────────────────┐  HMAC    ┌────────────────────────────┐
│ apps/mobile   │──────▶ │ apps/gateway       │────────▶ │  Control Plane (CF Worker) │
│  • profiles[] │ appJWT │  (CF Worker)       │ pub URL  │  REST + /sessions/:id/     │
│  • active prof│◀─────▶ │  GET /config       │          │  ws-token                  │
│ @expo/ui      │ REST   │  OAuth+allowlist   │          └─────────────┬──────────────┘
│ FlashList(str)│        │  appJWT  HMAC proxy│                        │ DO per session
│               │        │  push cron-poll    │                        │
│               │  opaque WS token (via gateway)                       │
│               │────────── wss://<wsUrl from /config>/sessions/:id/ws ┘  (DIRECT)
└───────────────┘  subscribe + stream   (gateway NOT in the WS path)
        │  packages/protocol  (vendored+pinned types; consumed by both apps — PLAN-04)
```

## Irreducible pieces

| Piece | Why unavoidable | Doc |
|---|---|---|
| Mobile Gateway (`apps/gateway`) | app can't hold HMAC secret; CP has no per-user auth | [[PLAN-01-gateway]] |
| Connection-profile settings | self-hosted → URL differs per deployment | [[PLAN-02-realtime-rn]] |
| Direct WS client in RN | the live experience | [[PLAN-02-realtime-rn]] |
| Push (Expo Push + cron-poll) | "background agents" UX | [[PLAN-03-push]] |
| Vendored+pinned types + smoke test | drift safety | [[PLAN-04-protocol-pinning]] |

## How to start (bootstrap → handoff workflow)

**Step A — human scaffolds (deterministic; don't make an agent guess CLI). pnpm only, no
heredocs (paste-safe):**

```bash
git clone git@github.com:refrakts/constructor-mobile.git
cd constructor-mobile
echo '{"name":"constructor-mobile","private":true}' > package.json
printf '%s\n' 'packages:' "  - 'apps/*'" "  - 'packages/*'" > pnpm-workspace.yaml
echo 'node-linker=hoisted' > .npmrc                       # REQUIRED for Expo+pnpm

pnpm dlx create-expo-app@latest apps/mobile --no-install
pnpm dlx create-cloudflare@latest apps/gateway --type=hello-world --lang=ts --no-deploy --no-git

mkdir -p packages/protocol/src
echo '{"name":"@constructor/protocol","private":true,"version":"0.0.0","main":"src/index.ts","types":"src/index.ts"}' > packages/protocol/package.json

printf '%s\n' \
'const { getDefaultConfig } = require("expo/metro-config");' \
'const path = require("path");' \
'const projectRoot = __dirname;' \
'const workspaceRoot = path.resolve(projectRoot, "../..");' \
'const config = getDefaultConfig(projectRoot);' \
'config.watchFolders = [workspaceRoot];' \
'config.resolver.nodeModulesPaths = [' \
'  path.resolve(projectRoot, "node_modules"),' \
'  path.resolve(workspaceRoot, "node_modules"),' \
'];' \
'config.resolver.disableHierarchicalLookup = true;' \
'module.exports = config;' \
> apps/mobile/metro.config.js

pnpm install
( cd apps/mobile \
  && pnpm exec expo install @expo/ui expo-secure-store expo-auth-session expo-web-browser \
                            expo-crypto expo-notifications expo-constants @shopify/flash-list \
  && pnpm add @tanstack/react-query react-native-markdown-display )
( cd apps/gateway && pnpm add jose )
( cd apps/mobile && pnpm dlx eas-cli init )               # EAS projectId for push
```

> `.npmrc` `node-linker=hoisted` must exist **before** `pnpm install` so the store is
> hoisted from the start — this + the Metro config above is the only friction the
> single-repo + pnpm choice adds.

**Step B** — vendor protocol into `packages/protocol` pinned to the deployed control-plane
SHA ([[PLAN-04-protocol-pinning]]); commit `packages/protocol/PIN`.

**Step C** — run **M0** (contract spike, [[PLAN-04-protocol-pinning]] §3). The gate.

**Step D** — hand the implementing agent the scaffolded monorepo + vendored
`packages/protocol` + PLAN-00..05: "execute M1→M5 in order; stack committed, don't
re-decide; M0 must be green."

## Milestones (acceptance in [[PLAN-05-config-and-risks]])

M0 contract spike → M1 gateway core → M2 RN core loop (profile setup → sign in →
list/create → live stream → follow-up) → M3 breadth → M4 push → M5 hardening.

## Reading order

This → [[PLAN-01-gateway]] (trust model) → [[PLAN-02-realtime-rn]] (core + settings + UI) →
[[PLAN-04-protocol-pinning]] (do early) → [[PLAN-03-push]] → [[PLAN-05-config-and-risks]].

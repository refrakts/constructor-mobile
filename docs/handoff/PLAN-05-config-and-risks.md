# PLAN 05 — Config, Deploy, Security, Milestones & Risks

> ← [[PLAN-00-overview]]. Decisions committed (best/standard). None of this configuration is
> in `background-agents`. Repo = one monorepo (`apps/mobile`, `apps/gateway`,
> `packages/protocol`; pnpm workspaces).

## Configuration (all outside `background-agents`)

### GitHub OAuth App (committed: a separate mobile OAuth App)

Dedicated **mobile** GitHub OAuth App — independent client secret/revocation, doesn't disturb
web. Scope must equal upstream `read:user user:email repo` (`packages/web/src/lib/auth.ts:36`).
Callback `https://<gateway-host>/auth/github/callback`. The app's own redirect leg uses an
**HTTPS Universal Link** (Associated Domains; AASA hosted on the gateway domain) — not a
custom scheme (GitHub rejects those). Operator action in github.com / Apple / the gateway.

### Endpoint config (committed: nothing hardcoded in the app)

App stores **connection profiles** ([[PLAN-02-realtime-rn]] §Settings); user enters only
`gatewayUrl`; `wsUrl` discovered via `GET /config` ([[PLAN-01-gateway]]). Only build-time app
value = EAS `projectId` — not an endpoint.

### Secrets / env

| Where | Name | Source |
|---|---|---|
| `apps/gateway` | `INTERNAL_CALLBACK_SECRET` | **same value as upstream** (config, not code) — god-mode, guard |
| `apps/gateway` | `CONTROL_PLANE_URL`, `WS_URL` | the deployed control-plane Worker (confirm per deployment) |
| `apps/gateway` | `GH_ID` / `GH_SECRET` | the **mobile** GitHub OAuth App |
| `apps/gateway` | `APP_JWT_SIGNING_KEY` | new, gateway-owned (`jose`) |
| `apps/gateway` | `ALLOWED_USERS` / `ALLOWED_EMAIL_DOMAINS` / `UNSAFE_ALLOW_ALL_USERS` | **mirror upstream values** |
| `apps/gateway` | Expo push access token + KV namespace | Expo / Cloudflare |
| `apps/mobile` (build) | EAS `projectId`, Universal Link domain | EAS / Apple — *no endpoints, no secrets* |

### Repo, deploy & cost (EAS is free for this)

- **One pnpm monorepo.** Two one-time Expo+pnpm steps: an `.npmrc` with
  `node-linker=hoisted` (pnpm's symlinked node_modules breaks Metro resolution) **and** the standard
  `apps/mobile/metro.config.js` (`watchFolders=[workspaceRoot]`, `nodeModulesPaths`,
  `disableHierarchicalLookup=true`) per Expo "Working with monorepos". Only friction the
  single-repo choice adds.
- **Gateway**: own `wrangler.toml` in `apps/gateway`, `wrangler deploy`,
  `wrangler secret put`, `[triggers] crons` for the push poll. No service binding → no
  two-phase deploy, no upstream Terraform.
- **Cost (confirmed adequate on free tiers):** Expo **Push is free** (no APNs cert/HTTP2 —
  why [[PLAN-03-push]] chose it). EAS **Build free tier** is adequate for iOS dev/internal
  builds (low monthly volume). Cloudflare Workers/KV/cron — free tier covers a single-tenant
  org. **One honest non-Expo cost:** App Store *distribution* needs a paid **Apple Developer
  account** ($99/yr) — Apple's cost, unavoidable for any iOS app; dev on a device/simulator
  and internal distribution do not need it short-term.

## Security model (read this)

Gateway holds `INTERNAL_CALLBACK_SECRET` = **org-wide god-mode** on the control plane (no
per-user authz upstream; `router.ts:606-630`; README "Security Model"). **The gateway's
OAuth + allowlist gate is the entire mobile access control** — wrong gate = full compromise.
Keep the allowlist in lockstep with the web app's (vendor `access-control.ts`,
[[PLAN-04-protocol-pinning]]) — drift here is a security bug. App holds only a short-lived
appJWT + refresh per profile in `expo-secure-store` (Keychain); never the HMAC secret, never
long-lived raw GitHub tokens. ws-token TTL 24 h (`durable-object.ts:109`); appJWT ~15 min +
refresh; on `4001/4002` drop tokens and re-bootstrap. **Single-tenant only — do not expose
the gateway to untrusted users.**

## Bootstrap → handoff workflow

A. Human runs the monorepo scaffold ([[PLAN-00-overview]] §How to start) + the Metro
monorepo config. B. Vendor protocol into `packages/protocol` pinned to the deployed CP SHA
([[PLAN-04-protocol-pinning]]). C. Run **M0** (contract spike) — the gate. D. Hand the
implementing agent the monorepo + vendored `packages/protocol` + PLAN-00..05: "execute
M1→M5 in order; stack committed, don't re-decide; M0 must be green."

## Milestones & acceptance

| M | Done when |
|---|---|
| **M0** | Script: HMAC → `POST /sessions` → `ws-token` → WS `subscribe` → prints `sandbox_event`s vs the real deployment; `subscribed`/event-shape assertions pass. **Gate.** |
| **M1** | App: add profile → `GET /config` → OAuth (system browser) → allowlist enforced → appJWT; `sessions` + `ws-token` proxy work with HMAC. |
| **M2** | Profile setup → sign in → list/create session (repo/branch/model/effort, `@expo/ui` forms) → live stream renders natively (markdown + FlashList) → follow-up → stop. No WebView. |
| **M3** | History/resume (replay + `fetch_history` + REST), secrets, automations, screenshots via gateway passthrough, presence UI, multi-profile switching (cache isolation verified). |
| **M4** | Register device → cron-poll detects completion/error/artifact → Expo push → tap deep-links; dedupe verified (no double-fire). |
| **M5** | Contract smoke in CI + scheduled; reconnect/AppState/background; token refresh; idempotent events; error/empty/permission UX; `@expo/ui` fallbacks audited. |

## Risks & open decisions (user owns)

1. **GitHub PKCE assumption** — design assumes GitHub OAuth needs a client secret and lacks
   PKCE (→ gateway exchange). Stable to our knowledge; **verify current GitHub docs before
   M1** (load-bearing). *(Not mine to "just pick" — an external fact to confirm.)*
2. **`@expo/ui` maturity** — experimental/alpha, partial coverage, SDK 52+/new arch. Risk
   isolated behind the `ui/` wrapper + plain-RN fallback ([[PLAN-02-realtime-rn]]); confirm
   per-screen component coverage against current Expo docs during M2.
3. **Notification "which sessions" policy** — default user's active sessions, capped; change
   only if explicit subscribe-on-open is wanted ([[PLAN-03-push]]).
4. **Behavioral protocol drift** not caught by type diffs — covered only by the *behavioral*
   smoke assertions; invest there ([[PLAN-04-protocol-pinning]]).
5. **Secret-rotation ops coupling** — rotating `INTERNAL_CALLBACK_SECRET` upstream requires
   updating the gateway secret too (config, not code). Define runbook + owner.
6. **Read-only study could not execute anything** — every protocol claim is
   verified-by-reading, not live. **M0 is the first thing to actually run** and the
   permanent drift alarm.

## Not in scope (reaffirmed)

ttyd terminal, code-server — inherently browser, excluded. CP still emits
`ttyd_info`/`code_server_info`; the app ignores them. No WebView anywhere.

Design: [[PLAN-01-gateway]] · [[PLAN-02-realtime-rn]] · [[PLAN-03-push]] ·
[[PLAN-04-protocol-pinning]]. Evidence: [[FINAL-feasibility]], [[02-control-plane]],
[[03-data-plane]], [[06-auth-and-tokens]].

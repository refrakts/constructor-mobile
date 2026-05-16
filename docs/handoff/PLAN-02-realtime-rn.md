# PLAN 02 — Realtime in RN + Connection Settings + UI (native, no WebView)

> ← [[PLAN-00-overview]] · contract [[PLAN-04-protocol-pinning]] · ref impl
> `packages/web/src/hooks/use-session-socket.ts` (verified). Stack committed in
> [[PLAN-00-overview]] — build it, don't re-pick. Lives in `apps/mobile`.

## The key fact

The WS is directly reachable and origin/cookie-free: upgrade intercepted in
`packages/control-plane/src/index.ts:25-28` *before* auth, forwarded to the SessionDO, which
authenticates purely by an opaque token in the first message
(`durable-object.ts:1141-1187`) — no cookie, no `Origin`, no subprotocol, CORS `*`. RN's
global `WebSocket` speaks this with zero shims. The rich part is the cheap part.

## UI layer: `@expo/ui` (committed) — with an honest boundary

Per user preference (iPhone user wanting native feel), `@expo/ui` (native **SwiftUI**
components) is the UI lib for the app **chrome**. It is **experimental/alpha, partial
component coverage, requires SDK 52+/new architecture** — confirm current component coverage
against Expo docs before relying on it for a given screen.

- **Use `@expo/ui` for:** the connection-profiles/settings screens, sign-in screen, session
  list, create-session form (repo/branch/model/reasoning-effort pickers), action buttons,
  switches/toggles, confirm sheets. These map cleanly to SwiftUI `Form`/`List`/`Picker`/
  `Button`/`Switch`/`BottomSheet`.
- **Do NOT use `@expo/ui` for:** the streamed event log (use `@shopify/flash-list` — Expo UI
  lists aren't built for thousands of streamed updates) or agent content (use
  `react-native-markdown-display`). Expo UI is chrome, not the firehose.
- **Fallback rule:** anything `@expo/ui` doesn't cover yet → plain RN components + styling.
  Keep a thin `ui/` wrapper module so a missing Expo UI primitive is a one-file swap, not a
  refactor. (This isolates the experimental-lib risk.)

## Settings: connection profiles (committed — nothing hardcoded)

Open-Inspect is self-hosted → gateway URL differs per deployment and a user may have several.
The user types **only** `gatewayUrl`; `wsUrl` comes from the gateway `GET /config`
([[PLAN-01-gateway]]).

```ts
type Profile = { id: string; name: string; gatewayUrl: string; wsUrl?: string };
// { profiles: Profile[], activeProfileId }  -> AsyncStorage  (non-secret)
// per profile { appJwt, refreshToken }      -> expo-secure-store  key `auth:${id}`
```

Behavior (build the screens with `@expo/ui` `Form`/`List`):
- First launch / no profile → "Add connection" (name + gateway URL). On save: `GET
  ${gatewayUrl}/config` → cache `wsUrl` → route to sign-in ([[PLAN-01-gateway]] OAuth).
- Settings → Connections: add / edit / delete / **set active**. Switching swaps the entire
  API context (base URL + that profile's appJWT from secure-store) and **clears the TanStack
  Query cache**; profiles never bleed. Each profile = its own identity/login state.
- Every API call and the WS read `activeProfile.gatewayUrl`/`.wsUrl`. No compiled-in
  endpoint. Only build-time app value = EAS `projectId` (push) — not an endpoint.

## The exact handshake (port verbatim from web)

Verified in `use-session-socket.ts`:
1. ws-token from **gateway** `POST /sessions/:id/ws-token` → `{token}` (`:485-512`).
2. `new WebSocket(\`${wsBase}/sessions/${id}/ws\`)` (`:544-548`) — direct to control plane;
   `wsBase` = active profile's discovered `wsUrl`.
3. On open send `{type:"subscribe",token,clientId}` within 30 s (`WS_AUTH_TIMEOUT_MS`,
   `durable-object.ts:102`) — `:561-568`.
4. Receive `subscribed` (`SessionState` + `replay{events,hasMore,cursor}` ≤500), then stream.
5. Ping every 30 s (`:744-753`); reconnect exp backoff `min(1000·2^n,30000)` max 5, unclean
   only (`:610-626`); close **4001**→drop token+re-auth, **4002**→re-token, **4008**→timeout.

## Protocol contract (single source of truth)

From `packages/protocol` (vendored `packages/shared/src/types/index.ts`,
[[PLAN-04-protocol-pinning]]): `ClientMessage` (`:271-284`), `ServerMessage` (`:286-335`),
`SandboxEvent` (`:167-268`), `SessionState` (`:338-359`). Semantics ([[03-data-plane]]):
- `token` events: **cumulative live, coalesced on replay** → live replace per `messageId`;
  replay one final/message. Port `collapseTokenEvents`
  (`use-session-socket.ts:63-99`)/`processSandboxEvent` (`:227-274`) verbatim — pure.
- Criticals at-least-once → dedupe `(messageId,type,timestamp)`; idempotent.
- Reconnect = replay(≤500)+`fetch_history` (`:700-711`), not a since-cursor delta →
  reconcile by id. Ignore `ttyd_info`/`code_server_info`.

## Porting `use-session-socket.ts` → RN: deltas only

| Web | RN |
|---|---|
| `crypto.randomUUID()` (`:566`) | `expo-crypto` `randomUUID()` |
| `fetch('/api/.../ws-token')` (`:487`) | `fetch(\`${gatewayUrl}/sessions/${id}/ws-token\`,{headers:{Authorization:\`Bearer ${appJwt}\`}})` |
| `WS_URL` env (`:17`) | `activeProfile.wsUrl` (from `GET /config`) |
| `localStorage` | `expo-secure-store` / `AsyncStorage` |
| visibility events | RN `AppState` → reconnect on `active` |

State machine, backoff, ping, token folding, `handleMessage` (`:276-481`) port unchanged
(no DOM). Outbound pure-WS: `prompt` (`:661-668`), `stop` (`:690`), `typing` (`:697`),
`fetch_history` (`:704-710`).

## Native rendering (no WebView)

- Agent content: **`react-native-markdown-display`** (raw-HTML off, size-capped). Feeding
  model is portable; only the renderer swaps from web's `react-markdown`.
- Tool calls/steps: native collapsible rows (`@expo/ui` `Section`/`DisclosureGroup` if
  covered, else RN) reusing web's pure grouping logic.
- Stream list: **`@shopify/flash-list`** + `maintainVisibleContentPosition` + jump-to-latest
  (replaces web `IntersectionObserver`/`scrollIntoView`).
- Screenshots: **`expo-image`** → `GET ${gatewayUrl}/sessions/:id/media/:artifactId` with the
  appJWT header. Never a cookie URL.

## State management

**TanStack Query** keyed to the active profile's gateway URL for lists (include
`activeProfileId` in keys). Active-session events/state/participants/artifacts stay in the
socket hook's local `useState`/`useRef` (mirrors web — not in the query cache). On
status-changing WS messages invalidate the session-list query
(`use-session-socket.ts:453-459`).

## Free win

DO broadcasts to all client sockets regardless of type → **real multiplayer/presence with
web users** for free; just render `presence_*` (`use-session-socket.ts:339-362`). Cursors
are in the protocol but web never sends them — no parity gap, don't build.

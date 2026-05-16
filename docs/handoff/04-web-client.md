# 04 — Web Client: how it consumes the control plane

`packages/web` (Next.js 16 / React 19). The closest reference for what a mobile client must
replicate. **[O]** observed, **[I]** inferred.

## HTTP: there is no client API SDK — it's same-origin `/api/*` + SWR

- Client data layer = **SWR** with a trivial fetcher `fetch(url).then(r=>r.json())` against
  **relative `/api/...` URLs** (`src/app/providers.tsx`). Mutations = raw
  `fetch("/api/...")` / `useSWRMutation`. No bearer token attached client-side — auth is the
  **NextAuth cookie**, implicit and same-origin. [O]
- Every `/api/*` route is a **Next.js Route Handler** that (1) `getServerSession(authOptions)`
  to enforce the cookie session, (2) calls `controlPlaneFetch` which signs with the
  server-only HMAC secret. Verified: `src/lib/control-plane.ts:29-49,107-131`
  (`process.env.INTERNAL_CALLBACK_SECRET` + `CONTROL_PLANE_URL`, prefers a Cloudflare
  service binding), and `src/app/api/sessions/[id]/ws-token/route.ts:17-71`
  (`getServerSession` → 401 if absent → `controlPlaneFetch('/sessions/:id/ws-token', …)`). [O]
- **None of the `/api/*` layer is reusable by a native app** — it is server-runtime + cookie
  coupled. A mobile client must talk to its own equivalent tier. [I]

## WebSocket: clean and portable (verified in `src/hooks/use-session-socket.ts`)

Reference handshake (lines verified):
1. `fetchWsToken()` → `POST /api/sessions/${id}/ws-token` (the BFF route), returns
   `{token}` (`:485-512`). 401 → "Please sign in".
2. `WS_URL = process.env.NEXT_PUBLIC_WS_URL` — **inlined into the bundle, points directly at
   the control-plane Worker** (not the Next app). A mobile app can hold the same value. (`:17`)
3. `new WebSocket(`${WS_URL}/sessions/${id}/ws`)` (`:544-548`).
4. `onopen` → send `{type:"subscribe", token, clientId: crypto.randomUUID()}` (`:561-568`).
5. `onmessage` → `parseWsMessage(JSON.parse(...))` → `handleMessage` switch over the
   `ServerMessage` union → React state.
6. Reconnect: exponential backoff `min(1000·2^n, 30000)`, **max 5 attempts**, only on
   unclean close (`:610-626`). Close `4001` → clear token + auth error; `4002` → clear token
   + "session expired" (`:595-607`). Ping `{type:"ping"}` every 30 s (`:744-753`).
7. Outbound: `prompt` (`:661-668`), `stop` (`:690`), `typing` (`:697`), `fetch_history`
   (`:704-710`).

**The wire protocol has zero browser-only dependency.** RN's global `WebSocket` handles it;
`crypto.randomUUID` is polyfillable (`expo-crypto`). The hook's state machine
(reconnect/heartbeat/token-folding via `collapseTokenEvents`) is portable React. The single
coupling point is `fetchWsToken` hitting the cookie-gated `/api/...ws-token` proxy. [O/I]

## State management

No Redux/Zustand/React Query. **SWR** for lists (session list keyed by
`"/api/sessions?..."`), **local `useState`/`useRef` inside `useSessionSocket`** for the
active session's events/state/participants/artifacts. WS handlers call `mutate(...)` to
refresh SWR lists on status changes. UI prefs in `localStorage`. [O]
→ SWR works in RN but every key is a `/api/*` URL (swap the fetcher/keys); the socket-hook
state model ports as-is; `localStorage` → `expo-secure-store`/`AsyncStorage`. [I]

## Feature inventory (component → portability)

| Feature | Where | Mobile verdict |
|---|---|---|
| Start session (prompt+repo+model+effort) | `src/app/(app)/page.tsx` → `POST /api/sessions` then `/api/sessions/[id]/prompt`; repos `use-repos`, models `use-enabled-models` | **Yes**, via new auth tier. Logic portable; `localStorage` for last repo/model → device storage. |
| Live agent stream | `useSessionSocket` + `SessionContent`/`EventItem` | **Yes** over WS (portable). Rendering uses `react-markdown`+`rehype-*` → needs RN markdown lib. |
| Send follow-up prompt | `sendPrompt` over WS | **Yes** — pure WS, no coupling. |
| Session history + resume | `SessionSidebar` (SWR list) → navigate → mount socket → `subscribed.replay` + `fetch_history` | **Yes** — list via auth tier; replay/pagination over WS portable. |
| Repo secrets | `secrets-editor.tsx` → `/api/secrets`, `/api/repos/:o/:n/secrets` | **Yes** via auth tier. `.env` paste uses `ClipboardEvent` → `expo-clipboard`. |
| Automations config/trigger | `automations/*` + `use-automations` → `/api/automations/*` | **Yes** via auth tier. `Intl.supportedValuesOf("timeZone")` — verify on Hermes. |
| Multiplayer presence/typing | presence in `useSessionSocket` | **Yes** — pure WS. Cursors are in the protocol but web never sends them (no parity gap). |
| Terminal (ttyd) | `terminal-panel.tsx` = **`<iframe sandbox=…>`** | **Hard.** No iframe on iOS. Native ttyd-protocol client or in-app WebView. Defer (see [[03-data-plane]]). |
| Code-server / VS Code | `code-server-section.tsx` = external `<a target=_blank>` | **No native parity.** Open in Safari / WebView. Defer. |
| Screenshots/media | `<img src="/api/sessions/[id]/media/[artifactId]">` (cookie-auth binary proxy, `Vary: Cookie`) | Needs an authenticated media fetch via the new tier (control-plane route is HMAC; fine behind BFF). |

## Browser-only / server-coupled assumptions (the porting obstacles)

1. **NextAuth HttpOnly cookie** is the only browser auth credential (`useSession()`
   everywhere). Not a bearer token. [O]
2. **~25 `/api/**` Route Handlers** = the de-facto API; cookie + server runtime; not callable
   from native. [O]
3. Control-plane REST needs the **HMAC shared secret** (cannot ship in an app). [O]
4. WS-token acquisition is proxy-coupled (cookie). The WS endpoint itself is *not* coupled. [O]
5. Same-origin relative `/api` + cookies (no CORS/bearer for data). [O]
6. UI runtime APIs: `<iframe>` (ttyd), `target=_blank` (code-server), `IntersectionObserver`/
   `scrollIntoView` (auto-scroll), `localStorage`, Clipboard, `react-markdown`/`recharts`,
   Radix UI, `next/navigation`/`next/link` — all need RN equivalents (medium effort). [O]

**Not obstacles:** the WS wire protocol + `useSessionSocket` state machine; pure libs in
`src/lib/**`; `@open-inspect/shared` types.

Cross-references: [[02-control-plane]] [[05-shared-package]] [[06-auth-and-tokens]]
[[07-gaps-and-blockers]]

# Feasibility: an Expo / React Native iOS client for Open-Inspect

Read-only code study. Working notes: [[01-overview]] [[02-control-plane]] [[03-data-plane]]
[[04-web-client]] [[05-shared-package]] [[06-auth-and-tokens]] [[07-gaps-and-blockers]].
Notation: facts marked **[O]** were observed directly in code (file:line given); **[I]** is
inferred/design judgement.

---

## 1. TL;DR

**Feasible, and the interactive core is genuinely easy — but it is gated behind one
architectural fact: the control plane has no end-user authentication.** It accepts only a
shared HMAC *service* secret on its REST surface (`router.ts:606-630`). The web "client" is
actually a Backend-for-Frontend (BFF): the browser holds a NextAuth cookie, and Next.js
server routes hold the secret and proxy to the control plane. The three existing bots
(Slack/GitHub/Linear) do the same thing server-side — they are the exact precedent for what a
mobile app needs.

So the effort shape is **weeks, not months, and the time goes almost entirely into a new
server tier, not the app**:

- **Days**: the live session experience. The WebSocket protocol is clean JSON, fully typed in
  `@open-inspect/shared`, with **zero browser coupling** — streaming, prompts, presence,
  history, resume port almost verbatim from `use-session-socket.ts`.
- **~1–2 weeks**: a small **mobile BFF** (a new Cloudflare Worker mirroring the bot pattern) +
  GitHub OAuth on device (`expo-auth-session` + PKCE) against a mobile-appropriate callback.
- **Separate, optional track**: push notifications — a real missing backend capability,
  important for a "background agents" product but not required to ship a v1.
- **Out of scope for v1**: the ttyd terminal and code-server (browser-bound; WebView at best).

There is **no blocker that makes this infeasible**; there is one unavoidable piece of new
backend (the auth/proxy tier) and one genuinely new feature if you want the product to feel
right on mobile (push).

---

## 2. System model (for someone who hasn't read the code)

Open-Inspect runs background coding sessions. Three tiers:

- **Web** (`packages/web`, Next.js): the UI.
- **Control plane** (`packages/control-plane`, Cloudflare Workers + Durable Objects): the
  coordinator. One Durable Object **per session** (`SessionDO`, addressed by
  `idFromName(sessionId)`), each with its own SQLite DB holding messages, events, artifacts,
  participants, and the sandbox reference. A second global `SchedulerDO` runs automations.
- **Data plane** (`packages/modal-infra`, Modal): disposable Linux sandboxes running the
  OpenCode agent. A "bridge" process in the sandbox opens an **outbound** WebSocket back to
  the session's DO and streams the agent's events. The DO persists them and **broadcasts**
  to every connected client. Mobile never touches Modal. [O, [[03-data-plane]]]

The load-bearing detail for this study is **how clients authenticate**:

- **REST**: every non-public route requires `Authorization: Bearer <ts>.<HMAC-SHA256(ts,
  INTERNAL_CALLBACK_SECRET)>`, ±5 min validity (`requireInternalAuth` `router.ts:606-630`;
  primitive `shared/src/auth.ts:63-127`). There is **no cookie, OAuth, or per-user token**
  at this layer — the secret *is* the trust boundary (single-tenant by design, README
  "Security Model"). The web app keeps the secret server-side
  (`web/src/lib/control-plane.ts:29-49`) and exposes ~25 cookie-gated `/api/*` route handlers
  to the browser. The bots keep the secret as a Worker secret and reach the control plane via
  a Cloudflare service binding, passing user identity as plain data fields. [O,
  [[06-auth-and-tokens]]]
- **WebSocket**: the upgrade is intercepted in `control-plane/src/index.ts:25-28` **before**
  the auth middleware and forwarded straight to the `SessionDO`. The DO authenticates a
  client socket purely by an **opaque random token sent in the first
  `{type:"subscribe"}` message** (`durable-object.ts:1141-1187`) — no cookie, no `Origin`
  check, no subprotocol, CORS `*`. That token is minted by `POST /sessions/:id/ws-token`
  (`ws-token.handler.ts:32-106`, 24 h TTL), which is itself HMAC-gated. [O — verified
  first-hand]

In one sentence: **the data/realtime protocol is portable and native-friendly; the only
thing standing between a mobile app and the control plane is a credential the app cannot
safely hold, so it needs the same kind of trusted proxy the bots already are.**

---

## 3. What the mobile client needs to talk to

It does **not** talk to Modal, and it **cannot** talk to the control-plane REST API directly
(no shippable credential) nor reuse `packages/web`'s `/api/*` (cookie + server runtime). It
talks to **(a) a new mobile BFF over HTTPS** and **(b) the control-plane WebSocket directly**.

**Control-plane REST surface the BFF must broker** (all HMAC; full table in
[[02-control-plane]]):
- Sessions: `GET/POST /sessions`, `GET/DELETE /sessions/:id`,
  `POST /sessions/:id/{prompt,stop,archive,unarchive}`, `PATCH /sessions/:id/title`,
  `GET /sessions/:id/{events,messages,artifacts,participants,children}`.
- **`POST /sessions/:id/ws-token`** → `{token, participantId}` (the bridge into realtime).
- Repos: `GET /repos`, `GET /repos/:o/:n/branches`.
- Settings/secrets/automations: `/model-preferences`, `/secrets`, `/repos/:o/:n/secrets`,
  `/automations*` (+ trigger/pause/resume/runs).
- Media passthrough: `GET /sessions/:id/media/:artifactId` (bytes).

**WebSocket the app speaks directly** — `wss://<NEXT_PUBLIC_WS_URL>/sessions/:id/ws`,
JSON discriminated-union on `type`:
- Client→server (`shared/src/types/index.ts:271-284`): `subscribe {token,clientId}`, `ping`,
  `prompt {content,model?,reasoningEffort?,attachments?}`, `stop`, `typing`,
  `fetch_history {cursor,limit?}`, `presence`.
- Server→client (`:286-335`): `subscribed` (carries `SessionState` + up to 500 replayed
  events), `sandbox_event {event}` (wraps every agent event — `token`, `tool_call`,
  `tool_result`, `step_*`, `execution_complete`, `artifact`, `push_*`, `user_message`, …),
  `prompt_queued`, `processing_status`, `history_page`, `presence_*`, `sandbox_status`/etc.,
  `artifact_created`, `session_status/title`, `child_session_update`, `ttyd_info`,
  `code_server_info`, `error`.
- Handshake (verified in `use-session-socket.ts`): POST ws-token (via BFF) → open socket →
  on open send `{type:"subscribe",token,clientId:uuid}` → consume `subscribed`+`replay` →
  stream. Reconnect: exp backoff, max 5; close `4001`/`4002` → drop token + re-auth; ping
  every 30 s; subscribe within 30 s of connect or closed (`4008`). [O]

This protocol is documented implicitly but **completely and statically** in
`@open-inspect/shared` types — a mobile client subscribes exactly as web does. [O]

---

## 4. Proposed architecture for the new Expo repo

Grounded in what exists (the bot pattern + the verified web handshake), not generic advice.

### 4.1 Two deliverables, one repo (or repo + Worker)

```
mobile/                         # the Expo app
infra/mobile-bff/               # new Cloudflare Worker (the trusted tier) — or add
                                #   authenticated routes to packages/web instead
packages/shared (consumed)      # protocol types — copy-vendored for v1 (see 4.4)
```

The **mobile BFF** is the only new backend. It is a near-copy of a bot: holds
`INTERNAL_CALLBACK_SECRET`, calls the control plane with `buildInternalAuthHeaders(...)`
(reuse `shared/src/auth.ts`), and exposes a small authenticated API to the app. It does
exactly what `web/src/lib/control-plane.ts` + the `/api/sessions/[id]/ws-token` route do,
minus NextAuth cookies.

### 4.2 Expo app stack (specific)

- **Runtime**: Expo (SDK current), React Native, Hermes; TypeScript.
- **Navigation**: `expo-router` (or React Navigation) — replaces `next/navigation`.
- **Auth**: `expo-auth-session` + `expo-web-browser` + `expo-crypto`, GitHub OAuth
  **Authorization Code + PKCE**. Callback = an **HTTPS Universal Link** (or the BFF's
  callback) — *not* a custom scheme (GitHub OAuth Apps reject custom schemes,
  [[06-auth-and-tokens]]). Tokens in `expo-secure-store`.
- **WebSocket**: the built-in RN `WebSocket` global. Port `use-session-socket.ts` almost
  verbatim — its reconnect/heartbeat/`collapseTokenEvents` logic has no DOM dependency.
  `crypto.randomUUID` → `expo-crypto`.
- **Server state**: SWR or TanStack Query against the BFF base URL (web uses SWR; either
  works in RN). Keep the active-session event stream in the ported socket hook's local
  state, exactly as web does (it is not in SWR there).
- **Markdown**: an RN markdown renderer (e.g. `react-native-markdown-display`) — web's
  `react-markdown`/`rehype-*` is DOM-bound.
- **Storage/clipboard**: `expo-secure-store` (tokens), `AsyncStorage` (prefs),
  `expo-clipboard` (replaces web Clipboard usage in secrets editor).
- **State management approach**: thin — server cache (SWR/Query) + the socket hook's
  `useState`/`useRef` machine. No Redux/Zustand needed; mirrors web.

### 4.3 Mobile BFF surface (minimal)

- `POST /auth/github` — exchange the PKCE code; establish a BFF session (issue the app a
  short-lived BFF JWT). Validate the user against the same allowlist logic
  (`web/src/lib/access-control.ts`).
- Thin authenticated proxies (BFF session → HMAC): `GET/POST /sessions`,
  `GET/DELETE /sessions/:id`, `POST /sessions/:id/{prompt,stop,archive,...}`,
  **`POST /sessions/:id/ws-token`**, `GET /repos`, `/secrets*`, `/automations*`,
  media passthrough. (Literally the bot/web call pattern with a user-session check in front.)
- (Later) `POST /devices` + an APNs sender (see §6).

### 4.4 How it consumes `@open-inspect/shared`

The package is `private:true`, ESM-only, single barrel, built `dist` consumed via `file:`
([[05-shared-package]]). For a separate repo: **copy-vendor the pure subset** for v1 —
`src/types/**`, `models.ts`, `git.ts`, protocol/enum files. These are pure TypeScript with
no `node:*`/DOM/Cloudflare deps and run unmodified on Hermes (verified by full sweep). The
only runtime-unsafe code (`auth.ts` `crypto.subtle`) lives in the **BFF**, not the app, so
it never reaches the device. Long-term: publish a thin `@open-inspect/shared-protocol`
package to manage drift.

---

## 5. Feature scope for v1

| Feature | v1? | Why |
|---|---|---|
| Sign in (GitHub) | ✅ | Required. `expo-auth-session` + PKCE + BFF exchange. |
| Session list + open/resume | ✅ | List via BFF; resume = open socket, `subscribed.replay` + `fetch_history`. Portable. |
| Start session (prompt, repo, model, reasoning effort) | ✅ | `POST /sessions` + first prompt via BFF; selectors from `/repos`, `model-preferences`. |
| Live agent stream (tokens, tool calls, status) | ✅ | Pure WS; port `use-session-socket.ts`. The core value. |
| Send follow-up prompts / stop | ✅ | Pure WS messages. Trivial. |
| Multiplayer presence / typing | ✅ | Pure WS; nearly free once the socket is ported. (Cursors exist in the protocol but web never sends them — no parity gap.) |
| Repo secrets | ➖ optional | Straightforward via BFF; include if cheap, else fast-follow. |
| Automations (view/trigger) | ➖ optional | Same; read-only view is cheap, full CRUD can wait. |
| Push notifications | ❌ v1 / ✅ fast-follow | The product *wants* this, but it needs new backend (§6). Ship v1 with foreground/manual refresh; treat push as the headline fast-follow. |
| ttyd terminal | ❌ | Browser/iframe-bound; native = implement ttyd binary protocol or WebView. Defer. |
| Code-server / VS Code | ❌ | Full browser IDE; no native parity. External browser at most. |
| Screenshot artifacts | ✅ (small) | Needs a BFF media passthrough (web uses a cookie proxy). |

v1 thesis: **a fast, native "watch and steer your background agents from your phone" app** —
start/resume sessions, watch the stream, send follow-ups, see PRs. Terminal/IDE and rich
push are explicitly deferred.

---

## 6. Required backend changes

Stated concretely. **The answer is not "none."**

1. **A mobile BFF / trusted tier — required.** New Cloudflare Worker (recommended;
   bot-shaped, lowest risk, no control-plane change) *or* new authenticated non-cookie
   routes added to `packages/web`. Without this, the app has no safe way to reach the
   control plane. This is the bulk of the new work and it is well-bounded — the existing
   bots and `web/src/lib/control-plane.ts` are working templates.
2. **A mobile OAuth callback — required (config + tiny handler).** Either a Universal Link
   (Apple App Site Association hosted) used as the OAuth callback, or a separate GitHub
   OAuth App for mobile pointed at the BFF. The current single web callback
   (`/api/auth/callback/github`) cannot take a native redirect.
3. **Push notifications — required only if you want the product to feel right** (it's a
   background-agent product). New: device-token registration + an APNs sender in the BFF,
   triggered off terminal events the DO already produces (`execution_complete`, `error`,
   PR `artifact_created`). No such fan-out exists today. Deferrable past v1.
4. **Authenticated media passthrough — small, required for screenshots.** The control-plane
   route is HMAC and fine; the BFF just needs to proxy bytes (web does this via a cookie
   proxy the app can't use).
5. *Not required, nice-to-have*: an "events since cursor" endpoint. Current replay is
   "last 500 + manual pagination"; reconnect dedupe is solvable client-side, so this is an
   optimization, not a blocker.

No changes are required to the WebSocket protocol, the Durable Object model, or the data
plane. The control plane itself needs **zero changes** under the recommended (BFF) approach.

---

## 7. Risks & unknowns

Things not fully determinable from code alone — validate before committing:

1. **Public reachability of the control-plane Worker.** The web `controlPlaneFetch` prefers a
   Cloudflare *service binding*; a standalone BFF must use URL+HMAC (the present
   Vercel/local path). Confirm the control-plane Worker is reachable by public URL in the
   target deployment and that HMAC-over-public-URL is acceptable operationally. [I]
2. **ttyd as a native protocol client** is inferred from the proxy code (raw `tty`
   subprotocol WS, `?token=` auth), not tested. Spike before promising any in-app terminal.
3. **Single-tenant trust model.** The control plane does no per-user repo/session ownership
   check; a BFF holding the HMAC secret inherits org-wide authority. Acceptable for
   single-tenant/trusted users only — the BFF's user gate *is* the security boundary. Do not
   expose to untrusted users. [O]
4. **SCM-agnostic code paths** (GitHub/GitLab) — analysis assumed GitHub (the documented
   default). A non-GitHub deployment changes OAuth specifics.
5. **Backgrounding vs. sandbox lifetime.** iOS suspends the socket; with no client connected
   the sandbox can snapshot+stop in ~10 min. This is correct behavior but a UX design
   constraint (and the strongest argument for push). [O]
6. **Token-stream replay semantics.** Live `token` events are cumulative; replayed ones are
   final-coalesced. The ported hook already handles live; reconnect/replay reconciliation
   needs deliberate testing.

---

## 8. Recommended next steps

1. **Decide the trusted-tier shape** (1 decision): standalone mobile BFF Worker
   *(recommended — clean separation, mirrors bots)* vs. new authenticated routes in
   `packages/web`. This determines the whole project skeleton.
2. **Spike the realtime path end-to-end** (highest information per hour): a throwaway script
   that mints `INTERNAL_CALLBACK_SECRET` → `POST /sessions` → `POST /sessions/:id/ws-token`
   → opens `wss://…/sessions/:id/ws` → `subscribe` → prints `sandbox_event`s. Proves the
   protocol is exactly as documented and de-risks 80% of the app. (Read-only study could not
   run this — it is the first thing to actually execute.)
3. **Stand up the minimal BFF**: `POST /auth/github` (PKCE exchange + allowlist) and the
   `ws-token` + `sessions` proxies. Reuse `shared/src/auth.ts` and the bot/web call pattern.
4. **Port `use-session-socket.ts` into the Expo app** behind the BFF, render the event
   stream with an RN markdown component. That is a working, demoable v1 of the core loop.

Then iterate: session list/create UI, secrets/automations, and push as the headline
fast-follow. Defer terminal/code-server.

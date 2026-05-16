# 06 — Auth & Tokens (the trickiest part)

Verified against `web/src/lib/auth.ts`, `web/src/app/api/sessions/[id]/ws-token/route.ts`,
`control-plane/.../ws-token.handler.ts`, `shared/src/auth.ts`, `control-plane/src/router.ts`,
`docs/GETTING_STARTED.md`. **[O]** observed, **[I]** inferred.

## End-user login (web today)

- **GitHub OAuth App via NextAuth** `GitHubProvider`, scope `read:user user:email repo`
  (`web/src/lib/auth.ts:31-39`). [O]
- **Stateless JWT session** — no adapter/DB; NextAuth defaults to an **HttpOnly, SameSite=Lax,
  Secure** cookie signed with `NEXTAUTH_SECRET`. The JWT carries `accessToken`,
  `refreshToken`, `accessTokenExpiresAt`, `githubUserId`, `githubLogin`
  (`auth.ts:18-26,60-85`). [O]
- Access allowlist enforced in the `signIn` callback (`auth.ts:42-59`). [O]
- **No refresh logic in the web layer** (`jwt` callback only sets tokens on first sign-in,
  `auth.ts:60-66`); centralized SCM-token refresh lives in the control plane. [O]

## One GitHub App, two roles + the redirect-URI problem

`docs/GETTING_STARTED.md` Step 3: a **single GitHub App** provides both (a) OAuth user login
and (b) installation tokens for repo clone/push. Token architecture (README):

| Token | Purpose | Scope |
|---|---|---|
| GitHub App installation token | clone repos, push code | all repos where App installed |
| User OAuth token | create PRs, identify user | repos the user can access |
| Sandbox auth token | sandbox → control plane | single session |
| WebSocket token | client → session realtime | single session |

- The OAuth **callback URL is fixed to `<web-app>/api/auth/callback/github`** (NextAuth
  convention; `GETTING_STARTED.md:203-211`, Terraform asserts the web URL). It is an
  HTTPS web origin. **GitHub OAuth Apps do not support custom URL schemes** (`myapp://`). [O+I]
- Mobile implication: a native deep-link OAuth callback is **not registrable on the existing
  OAuth App**. Options: (1) HTTPS **Universal Link** as the callback (GitHub accepts
  `https://`), (2) a **separate GitHub OAuth App** for mobile whose callback is the mobile
  BFF, or (3) reuse the web app as an auth broker opened in `expo-web-browser`. [I]

## WebSocket token issuance

- Control plane: `POST /sessions/:id/ws-token` (`router.ts:489-492`) →
  `ws-token.handler.ts:32-106`. **HMAC-gated** (not public, not sandbox-auth). Body needs
  `{userId}` (+ optional scm fields). Mints `generateId(32)` random token, stores SHA-256
  hash + `ws_token_created_at`, returns `{token, participantId}`. [O — read directly]
- Web BFF: `web/src/app/api/sessions/[id]/ws-token/route.ts:17-71` — requires
  `getServerSession` (**NextAuth cookie**) → 401 if absent; pulls the JWT via `getToken`;
  proxies to the control plane with `controlPlaneFetch` (HMAC), forwarding the user's
  `accessToken/refreshToken/expiresAt` so the control plane can centrally refresh. [O]
- Lifetimes to design around: WS token TTL **24 h** (`durable-object.ts:109`); subscribe
  deadline **30 s** post-connect (`:102`); HMAC token validity **±5 min**
  (`shared/src/auth.ts:12`). [O]

**Can a non-web client with only an OAuth token call these?**
- The web BFF route: **No** — strictly requires the NextAuth cookie.
- The control-plane route: requires the **HMAC service secret**, not a user token.
→ A mobile app needs a trusted tier that holds the HMAC secret and authenticates the user
out-of-band. The opaque WS token, once obtained, the app uses **directly** on the socket
(no cookie/origin/CSRF gate). [O+I]

## The bots are the exact precedent

`slack-bot`/`github-bot`/`linear-bot` authenticate to the control plane with
`buildInternalAuthHeaders(env.INTERNAL_CALLBACK_SECRET, traceId)` (the same
`generateInternalToken` primitive, `shared/src/auth.ts:63-93`), calling
`env.CONTROL_PLANE.fetch("https://internal/...")` via a Cloudflare **service binding**.
User identity is passed as **plain, untrusted data fields** (`actorUserId`,
`actorDisplayName`, `actorEmail`, `spawnSource`). The trust boundary is "possesses the
service secret." [O]

**Reusable on a mobile device? No.** It is a single shared symmetric secret granting full,
identity-agnostic control of every session — safe only for operator-controlled server
components. The faithful mobile analog is a **server-side tier that mirrors the bot pattern**.

## CSRF / cookie / same-origin

- Control plane: CORS `*`, `Authorization` header auth, **no cookies, no CSRF** — no obstacle
  for a credentialed native client (and the WS upgrade has no origin/cookie check at all). [O]
- The barriers are entirely in the **Next.js BFF**: NextAuth HttpOnly cookie + NextAuth's
  built-in CSRF on its own POSTs; `NEXTAUTH_URL` pinned to the web origin. A stateless native
  bearer client cannot satisfy these → cannot reuse `/api/*`. [O+I]

## Mobile auth path (recommended)

1. App does GitHub OAuth itself (`expo-auth-session` + PKCE) against a mobile-appropriate
   callback (Universal Link or separate OAuth App / BFF callback).
2. App authenticates to a **mobile BFF** with the resulting identity (e.g., a session JWT the
   BFF issues, or the GitHub token validated by the BFF).
3. BFF (holding `INTERNAL_CALLBACK_SECRET`) proxies `POST /sessions`, `POST
   /sessions/:id/ws-token`, list/secrets/automations to the control plane — exactly as
   `web/src/lib/control-plane.ts` + the bots do.
4. App opens `wss://<control-plane>/sessions/:id/ws` directly and `subscribe`s with the
   opaque token. [I, grounded in the verified web handshake]

Cross-references: [[01-overview]] [[04-web-client]] [[07-gaps-and-blockers]]
[[FINAL-feasibility]]

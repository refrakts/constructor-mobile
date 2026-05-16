# 07 — Gaps & Blockers (what needs backend work)

**[O]** observed, **[I]** inferred. Ordered by severity for a mobile client.

## A. The one true blocker: no end-user auth on the control plane

The control plane authenticates only the **shared HMAC service secret**
(`router.ts:606-630`, `shared/src/auth.ts`); there is **no per-user credential it
understands**. The web app and all three bots compensate with a server-side tier that holds
the secret. A mobile app **cannot** ship the secret and **cannot** reuse the cookie-gated
Next.js `/api/*` routes. → **Requires new backend**: either
- **(Recommended) a mobile BFF** — a new Cloudflare Worker (or new authenticated routes on
  the existing web app) that authenticates the mobile user and proxies REST + mints WS
  tokens, mirroring `web/src/lib/control-plane.ts` and the bots. Lowest risk, no
  control-plane change. [I]
- **(Alternative) a first-class user-auth mode on the control plane** — accept a verified
  GitHub OAuth identity / bearer per-user. Larger change, new attack surface, touches the
  single-tenant trust model. [I]

Everything below is secondary to A.

## B. Deep-link OAuth callback

Existing OAuth callback is the fixed HTTPS web URL `<web>/api/auth/callback/github`; GitHub
OAuth Apps don't support custom URL schemes. → Need a Universal Link callback, a separate
mobile OAuth App, or web-as-broker (see [[06-auth-and-tokens]]). This is **config + a small
BFF callback handler**, not a deep code change. [O+I]

## C. Push notifications (genuine missing capability)

The product premise is "fire and forget; check later" (`docs/HOW_IT_WORKS.md`). There is
**no push mechanism anywhere** — no APNs, no notification persistence; the only "you have
output" signal is an open WebSocket. iOS cannot hold a socket open in the background. →
**Requires new backend**: the BFF (or control plane) must observe terminal events
(`execution_complete`, `error`, PR `artifact_created`) and send APNs. Hook point exists
conceptually (the DO already broadcasts these and uses callback contexts for Slack/Linear),
but no push fan-out for an app exists today. This is the biggest *new feature* beyond auth. [O+I]

## D. Backgrounding / reconnect semantics

- iOS suspends → WS drops → with no client connected the sandbox inactivity timer
  (~10 min, no extension) can snapshot+stop the sandbox sooner ([[03-data-plane]]). Not a
  bug, but the UX must explain "session paused, will resume on next prompt". [O]
- Reconnect must **re-fetch a fresh ws-token** (24 h TTL, and `4001`/`4002` clear it) and
  re-`subscribe`. Replay is "last 500 events" + manual `fetch_history`, **not** an
  events-since-cursor delta → the client must dedupe by event id and handle
  cumulative-vs-final `token` semantics. Workable client-side; a backend
  "events since cursor" endpoint would be a nice-to-have, not required. [O/I]

## E. Terminal (ttyd) and code-server

- ttyd: a native client *can* speak the raw `tty`-subprotocol WebSocket directly (token in
  `?token=`), but that means implementing ttyd's binary terminal protocol — real work.
  Pragmatic v1 = in-app `WebView` pointed at the ttyd proxy URL, or **defer**. [I]
- code-server: full browser IDE; web only links out. **No native parity** — defer / external
  browser. [O]

## F. Media artifacts

Screenshots are served by a **cookie-authenticated binary proxy** in the web app
(`/api/sessions/[id]/media/[artifactId]`, `Vary: Cookie`). Native `<Image>` can't send that
cookie. The underlying control-plane route (`GET /sessions/:id/media/:artifactId`, HMAC) is
fine — the **BFF must expose an authenticated media passthrough**. Small. [O]

## Risks & unknowns (could not fully determine from code alone)

1. **Web platform variant**: `web_platform` can be Vercel *or* Cloudflare/OpenNext; the
   service-binding path in `control-plane.ts` only exists on Cloudflare. A mobile BFF should
   use URL+HMAC (the Vercel/local path), which is present and simpler — but confirm the
   control-plane Worker is reachable by public URL in the target deployment. [I]
2. **`SCM_PROVIDER` abstraction**: code is SCM-agnostic in places (GitHub/GitLab). Assumed
   GitHub throughout; a non-GitHub deployment changes the OAuth specifics. [I]
3. **ws-token authZ depth**: the DO matches token-hash → participant with no extra per-user
   repo/session ownership check (single-tenant by design). A mobile BFF inherits that trust
   model — acceptable for single-tenant, **must not** be exposed to untrusted users. [O]
4. **ttyd native protocol**: that a raw `tty` WS client works is inferred from the proxy
   code, not tested. Validate with a spike before committing to native terminal. [I]
5. **Daytona backend**: an alternate sandbox provider exists with different resume semantics;
   the client protocol is the same, but timeouts/restore behavior differ. [O]

Cross-references: [[01-overview]] [[03-data-plane]] [[04-web-client]] [[06-auth-and-tokens]]
[[FINAL-feasibility]]

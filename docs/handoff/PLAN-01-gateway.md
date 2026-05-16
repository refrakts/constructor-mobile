# PLAN 01 — Mobile Gateway (`apps/gateway` workspace)

> Snippets are sketches; source of truth referenced inline. Decisions committed (best/standard
> only). ← [[PLAN-00-overview]] · [[PLAN-04-protocol-pinning]] · [[06-auth-and-tokens]]

## Why it exists (don't skip)

The control plane authenticates only the shared HMAC secret `INTERNAL_CALLBACK_SECRET`
(`packages/control-plane/src/router.ts:606-630`; primitive
`packages/shared/src/auth.ts:63-127`) and does **no per-user authz** — single-tenant, the
secret *is* the trust boundary (README "Security Model"). So the app can't hold it; the
gateway holds it and is the only new trusted component. **The gateway's OAuth + allowlist
gate is the entire mobile security boundary** — security-critical.

## Shape (committed)

A thin auth+proxy Worker — "a bot whose trigger is a mobile user" (same shape as
`packages/slack-bot`). Scaffold: `pnpm dlx create-cloudflare@latest apps/gateway` (C3, TS) + `pnpm add jose` — a workspace of the
one monorepo (`apps/mobile`, `apps/gateway`, `packages/protocol`), separate from
`background-agents`.
**Does not** touch D1/DO/R2, reimplement session logic, or sit in the WS path. Store =
**Cloudflare KV** (connection-agnostic: push registry + per-session cursors).

## Transport: public URL + HMAC (committed — not service binding)

Control plane is reachable by public URL and accepts HMAC there — the existing Vercel/local
path: `packages/web/src/lib/control-plane.ts:122-130`. A separate Worker just HMAC-`fetch`es
`CONTROL_PLANE_URL`. No binding into `background-agents` → no Terraform/deploy coupling. (A
service binding is a same-account perf optimization that would re-entangle deploys — rejected.)

## HMAC signer — reuse the exact upstream scheme

Source of truth `packages/shared/src/auth.ts:38-93`: token = `"<ms>.<hmacSHA256Hex(ms,
secret)>"`, header `Authorization: Bearer <token>`, validity ±5 min (`auth.ts:12`). Workers
have `crypto.subtle`, so upstream `generateInternalToken`/`buildInternalAuthHeaders` run
verbatim — **copy `auth.ts` into the vendored module** ([[PLAN-04-protocol-pinning]]) so it
can't drift.

```ts
// gateway/src/proxy.ts — mirror packages/shared/src/auth.ts:38-67 exactly
async function authHeader(secret: string) {
  const ts = Date.now().toString();
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(ts));
  const hex = [...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,"0")).join("");
  return `Bearer ${ts}.${hex}`;            // ±5min window enforced upstream (auth.ts:120)
}
```

## API surface (app → gateway). App auth = app-session JWT (`jose`, ~15 min) + refresh.

| App → Gateway | Gateway → Control Plane | Notes |
|---|---|---|
| `GET /config` | — | **returns `{ wsUrl }`** (+ branding/flags). App never hardcodes WS/CP URLs — only the gateway URL is user-entered ([[PLAN-02-realtime-rn]] §Settings) |
| `POST /auth/github/exchange` | — | code↔token exchange + allowlist + issue appJWT |
| `POST /auth/refresh` | — | rotate appJWT |
| `GET/POST /sessions`, `GET/DELETE /sessions/:id` | same (`router.ts:414-432`) | inject identity server-side |
| `POST /sessions/:id/{prompt,stop,archive,unarchive}` | same | |
| `POST /sessions/:id/ws-token` | same (`router.ts:489-492`) | **the WS bridge** |
| `GET /sessions/:id/{events,messages,artifacts,participants,children}` | same | history/REST |
| `GET /sessions/:id/media/:artifactId` | same | binary passthrough (screenshots) |
| `GET /repos`, `/repos/:o/:n/branches` | same (`routes/repos.ts:330-351`) | pickers |
| `GET/PUT /secrets`, `/repos/:o/:n/secrets[/:key]` | same (`routes/secrets.ts:375-406`) | |
| `GET /model-preferences`, `/automations*` | same | model picker / automations |
| `POST /push/register` | — | Expo push token → KV ([[PLAN-03-push]]) |

`POST /sessions` body (`shared CreateSessionRequest`; handler `router.ts:418-422`):
`{repoOwner,repoName,branch?,title?,model?,reasoningEffort?,spawnSource?,userId?,scm*?,
actor*?}`. Gateway sets `userId`/`actor*` from the appJWT and `spawnSource:"mobile"` — never
trust the client for identity.

## `GET /config` (so nothing is hardcoded)

```ts
// gateway: GET /config  (no auth or appJWT — safe, non-secret discovery)
return Response.json({ wsUrl: ENV.WS_URL, appName: ENV.APP_NAME ?? "Open-Inspect" });
```
The app calls this right after the user adds/selects a connection profile, caches `wsUrl`
per profile, and uses it for the **direct** WS connection. Result: the user enters one value
(gateway URL); everything else is discovered.

## OAuth exchange + allowlist (committed: separate mobile GitHub OAuth App)

Scope must equal upstream `read:user user:email repo` (`packages/web/src/lib/auth.ts:36`).
GitHub needs the client secret (no PKCE, to our knowledge — verify, [[PLAN-05-config-and-risks]]),
so the **gateway** exchanges; the app only obtains the `code` via the system browser
([[PLAN-02-realtime-rn]]).

```ts
// gateway/src/oauth.ts — sketch
const tok = await fetch("https://github.com/login/oauth/access_token", {
  method:"POST", headers:{Accept:"application/json","Content-Type":"application/json"},
  body: JSON.stringify({ client_id:ENV.GH_ID, client_secret:ENV.GH_SECRET, code, redirect_uri }),
}).then(r=>r.json());                                   // { access_token, refresh_token?, ... }
const gh = await fetch("https://api.github.com/user",
  { headers:{ Authorization:`Bearer ${tok.access_token}`, "User-Agent":"mobile-gw" }}).then(r=>r.json());

// ALLOWLIST GATE — vendor packages/web/src/lib/access-control.ts and run it with the
// gateway's ALLOWED_USERS / ALLOWED_EMAIL_DOMAINS / UNSAFE_ALLOW_ALL_USERS (mirror upstream
// values). !allowed -> 403, issue nothing. Drift here = security bug.

// issue appJWT (jose, ~15m) + opaque refresh (store hashed in KV). Keep GH access/refresh
// server-side; forward them ONLY to /sessions/:id/ws-token below.
```

## Minting the WS token (the one bridge into realtime)

Calls the existing endpoint; mints nothing itself. Mirror the web body
`packages/web/src/app/api/sessions/[id]/ws-token/route.ts:39-51`; handler
`packages/control-plane/src/session/http/handlers/ws-token.handler.ts:32-106` → `{token,
participantId}`, TTL 24 h (`durable-object.ts:109`).

```ts
const r = await fetch(`${ENV.CONTROL_PLANE_URL}/sessions/${id}/ws-token`, {
  method:"POST",
  headers:{ "Content-Type":"application/json", Authorization: await authHeader(ENV.SECRET) },
  body: JSON.stringify({ userId:c.sub, scmUserId:c.sub, scmLogin:c.login, scmName:c.name,
    scmEmail:c.email, scmToken:ghAccess, scmTokenExpiresAt:ghExpMs, scmRefreshToken:ghRefresh }),
});
return new Response(await r.text(), { status:r.status });   // -> { token, participantId }
```

## Secrets / env (Wrangler secrets)

`INTERNAL_CALLBACK_SECRET` (same value as upstream — config, not code) · `CONTROL_PLANE_URL`
· `WS_URL` · `GH_ID`/`GH_SECRET` (mobile OAuth App) · `APP_JWT_SIGNING_KEY` · `ALLOWED_USERS`
/ `ALLOWED_EMAIL_DOMAINS` / `UNSAFE_ALLOW_ALL_USERS` (mirror upstream) · Expo push token
([[PLAN-03-push]]) · KV namespace binding. Deploy independent of `background-agents`.

## Failure modes

HMAC clock skew > ±5 min → CP 401 (`auth.ts:120`); sign per request. `ws-token` 401 = HMAC
wrong (it's not public/sandbox, `router.ts:181-200`), not user auth. Confirm exact
`CONTROL_PLANE_URL`/`WS_URL` per deployment (always a CF Worker regardless of `web_platform`).

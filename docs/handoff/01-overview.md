# 01 — System Overview (mental model)

> Notation: **[O]** = observed directly in code (file:line). **[I]** = inferred.

## What the system is

Open-Inspect is a **single-tenant** background coding-agent platform. A "session" is the unit
of work: tied to one repo, persistent, multiplayer, stateful (messages / events / artifacts /
sandbox ref). Three tiers, glued by one WebSocket and a small REST surface:

1. **Web client** — Next.js 16 / React 19 (`packages/web`). Not a thin client — see below.
2. **Control plane** — Cloudflare Workers + Durable Objects (`packages/control-plane`).
   One `SessionDO` per session id (`idFromName(sessionId)`), each with its own SQLite DB.
   One global `SchedulerDO` for automations. D1 holds the session index, repo metadata,
   encrypted secrets.
3. **Data plane** — Modal Python sandboxes (`packages/modal-infra` + `packages/sandbox-runtime`).
   Runs OpenCode (the agent). Fully hidden behind the control plane.

Also: three **non-browser clients already exist** — `slack-bot`, `github-bot`, `linear-bot`
(Cloudflare Workers). These are the single most relevant precedent for a mobile client.

## The one fact that shapes the entire feasibility study

**The control plane has no end-user authentication.** Every non-public REST route requires a
shared-secret HMAC token (`INTERNAL_CALLBACK_SECRET`), verified by `requireInternalAuth`
(`router.ts:606-630`, `:366-399`; primitive in `shared/src/auth.ts:63-127`). Public routes are
only `/health` and two webhook patterns (`router.ts:181-185`).

Consequence: the web app is a **Backend-for-Frontend (BFF)**, not a direct client:

```
Browser ──NextAuth cookie──▶ Next.js /api/* route handlers ──HMAC secret──▶ Control Plane (REST)
Browser ──opaque WS token in first WS message──────────────────────────────▶ Control Plane (WS)
```

- `packages/web/src/lib/control-plane.ts` holds `INTERNAL_CALLBACK_SECRET` **server-side**
  (`process.env`, not `NEXT_PUBLIC_`) and signs every control-plane call (`:29-49,107-131`). [O]
- ~25 route handlers under `packages/web/src/app/api/**` each do
  `getServerSession(authOptions)` (cookie) then `controlPlaneFetch` (HMAC). [O]
- The bots do the identical thing server-side: hold `INTERNAL_CALLBACK_SECRET` as a Worker
  secret, call the control plane via a Cloudflare **service binding**, pass user identity as
  plain data fields (`actorUserId`, etc.). [O]

## The one surface that is already mobile-friendly

**The WebSocket is directly reachable and origin/cookie-free.** WS upgrades are intercepted in
`control-plane/src/index.ts:25-28` *before* the auth middleware and forwarded straight to the
`SessionDO`. The DO authenticates a client socket purely by an **opaque bearer token sent in
the first `{type:"subscribe"}` message** (`durable-object.ts:1141-1187`) — no cookie, no
`Origin` check, no subprotocol, CORS `*` on the 101 (`index.ts:80-88`). A native client can
speak this directly. The only catch: obtaining that token still goes through an HMAC-gated
REST endpoint (`POST /sessions/:id/ws-token`, `router.ts:489-492`).

## Net mental model for a mobile client

A mobile app can replicate ~all *interactive session* behavior over the existing WebSocket
protocol with zero browser coupling. The work is **not** UI re-skinning — it is replacing the
Next.js BFF: a mobile app needs a trusted server-side tier (bot-pattern) that authenticates
the user and mints WS tokens / proxies REST, because the control plane will not talk to an
end-user credential directly. See [[06-auth-and-tokens]] and [[07-gaps-and-blockers]].

Cross-references: [[02-control-plane]] [[03-data-plane]] [[04-web-client]]
[[05-shared-package]] [[FINAL-feasibility]]

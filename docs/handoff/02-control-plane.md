# 02 — Control Plane Surface

All paths relative to `packages/control-plane/` unless noted. **[O]** observed, **[I]** inferred.

## Entry & auth model

- `src/index.ts:21` Worker `fetch`. `Upgrade: websocket` → `handleWebSocket` (`:55-91`),
  **before** the router → **WS bypasses HMAC entirely**. [O]
- Else → `handleRequest` (router). Non-public routes → `requireInternalAuth`
  (`router.ts:606-630`). HMAC = `Authorization: Bearer <timestampMs>.<HMAC_SHA256(ts,secret)>`,
  ±5 min window (`shared/src/auth.ts:12,102-127`). The secret `INTERNAL_CALLBACK_SECRET` is
  shared by web, all bots, control plane, Modal. **No per-user identity in the token.** [O]
- `PUBLIC_ROUTES` (`router.ts:181-185`): `/health`, `/webhooks/sentry/:id`,
  `/webhooks/automation/:id`.
- `SANDBOX_AUTH_ROUTES` (`router.ts:192-200`): a few `/sessions/:id/...` routes that also
  accept a per-session sandbox bearer token (validated by the DO). Bot/sandbox only — not a
  client credential.
- CORS: `Access-Control-Allow-Origin: *`, allows `Authorization` header, no cookies, no CSRF
  (`router.ts:592-603`; `index.ts:84-86`). Native clients are unaffected by CORS anyway.

## HTTP routes (grouped)

Route table `router.ts:404-564`. **Auth = HMAC** unless noted.

**Session lifecycle**
- `GET /sessions` — list (D1 index). query `limit/offset/status/excludeStatus`.
- `POST /sessions` — create. body `{repoOwner,repoName,branch?,title?,model?,reasoningEffort?,
  spawnSource?,userId?,scm*?,actor*?}` → `201 {sessionId,status:"created"}`.
- `GET /sessions/:id` — state (→ DO `/internal/state`, returns `SessionState`).
- `DELETE /sessions/:id` — remove from D1 index.
- `POST /sessions/:id/prompt` — enqueue prompt (HTTP path; web uses this only for the first
  prompt, follow-ups go over WS). body `{content,authorId?,source?,model?,reasoningEffort?,
  attachments?,callbackContext?}`.
- `POST /sessions/:id/stop` — stop execution.
- `GET /sessions/:id/events` — paginated events. `GET …/messages`, `…/artifacts`,
  `…/participants` (GET/POST), `…/children` (GET/POST).
- `POST /sessions/:id/ws-token` — **issue WS token** (see below).
- `PATCH /sessions/:id/title`, `POST …/archive`, `…/unarchive`.
- `POST /sessions/:id/pr`, `…/media`, `…/openai-token-refresh`, `…/slack-notify`,
  `…/children/...` — also accept sandbox token (agent-initiated).
- `GET /sessions/:id/media/:artifactId` — streams image bytes from R2 (HMAC).

**Repos**: `GET /repos`, `GET/PUT /repos/:o/:n/metadata`, `GET /repos/:o/:n/branches`
(`routes/repos.ts:330-351`).
**Secrets**: `GET/PUT /repos/:o/:n/secrets`, `DELETE …/secrets/:key`, `GET/PUT /secrets`,
`DELETE /secrets/:key` (`routes/secrets.ts:375-406`).
**Settings**: `GET/PUT /model-preferences`; `GET/PUT/DELETE /integration-settings/:id[...]`.
**MCP servers**: `GET/POST /mcp-servers`, `GET/PUT/DELETE /mcp-servers/:id`.
**Automations**: `GET/POST /automations`, `GET/PUT/DELETE /automations/:id`,
`POST /automations/:id/{pause,resume,trigger,regenerate-key}`,
`GET /automations/:id/runs[/:runId]` (`routes/automations.ts:728-784`).
**Analytics**: `GET /analytics/{summary,timeseries,breakdown}`.
**Repo images**: `/repo-images/*` (Modal/scheduler-oriented, HMAC).
**Webhooks**: `POST /webhooks/sentry/:id`, `/webhooks/automation/:id` (public, per-automation
secret inside handler); `POST /internal/github-event` (HMAC, from github-bot).

## WebSocket protocol

- Single path: `wss://<cp>/sessions/:id/ws` (`index.ts:57`). `?type=sandbox` selects the
  sandbox variant (header-token auth, not a client concern).
- **Client handshake** [O]:
  1. Upgrade accepted unauthenticated; 30 s to authenticate (`WS_AUTH_TIMEOUT_MS=30000`,
     `durable-object.ts:102`) else close `4008`.
  2. Client sends `{type:"subscribe", token, clientId}` (`durable-object.ts:1102,1141`).
  3. Server SHA-256-hashes `token`, matches `participants.ws_auth_token`, rejects if missing
     (`4001`) or older than 24 h (`WS_TOKEN_TTL_MS`, `:109,1172-1187`).
  4. Server replies `{type:"subscribed", state, artifacts, participantId, replay{...}}`
     (`:1228-1244`).
- Framing: JSON text frames, discriminated union on `type`. Auto ping/pong via
  `setWebSocketAutoResponse`. DO uses the hibernation API (sockets survive idle).

**Client → server** (`shared/src/types/index.ts:271-284`): `ping`, `subscribe`,
`prompt {content,model?,reasoningEffort?,attachments?}`, `stop`, `typing`,
`presence {status,cursor?}`, `fetch_history {cursor,limit?}`. Dispatch
`durable-object.ts:1097-1125`.

**Server → client** (`shared/src/types/index.ts:286-335`): `pong`, `subscribed` (carries
`SessionState` + up to 500 replayed events), `prompt_queued`, **`sandbox_event {event}`**
(wraps every agent event), `presence_sync/update/leave`, `sandbox_warming/spawning/status/
ready/error/restored/warning`, `artifact_created`, `session_branch`, `snapshot_saved`,
`processing_status`, `history_page`, `session_status`, `session_title`,
`child_session_update`, `code_server_info {url,password}`, `ttyd_info {url,token}`,
`tunnel_urls`, `error`.

`SandboxEvent` variants inside `sandbox_event`/`replay`/`history_page`
(`shared/src/types/index.ts:167-268`): `heartbeat`, `token`, `tool_call`, `step_start`,
`step_finish`, `tool_result`, `git_sync`, `error`, `execution_complete`, `artifact`,
`push_complete`, `push_error`, `user_message`.

Close codes: `4001` auth required/invalid/expired, `4002` session expired post-hibernation,
`4008` auth timeout, plus standard `1000/1001/1006/1011`.

> The stream is **explicit and fully typed in `@open-inspect/shared`** — a mobile client can
> subscribe exactly as the web client does. See [[04-web-client]] for the reference handshake.

## ws-token issuance (the bridge into the WS world)

`POST /sessions/:id/ws-token` (`router.ts:489-492`) → DO handler
`session/http/handlers/ws-token.handler.ts:32-106`:
- Requires **HMAC** (not public, not sandbox-auth). Body requires `{userId}` (+ optional
  `scmUserId/scmLogin/scmName/scmEmail/scmToken*`).
- Upserts a `participant` row keyed by `userId`; mints `plainToken = generateId(32)`
  (32-byte random); stores only its SHA-256 hash + `ws_token_created_at` (`:93-96`).
- Returns `{token: plainToken, participantId}` (`:101-104`). TTL 24 h.
- **Callable by anything holding the HMAC secret** — no browser/cookie requirement at the
  control-plane layer. The cookie requirement lives in the *web* proxy, not here. [O]

## Durable Object boundaries

- `SessionDO` — one per session id; owns SQLite (`session`, `participants` incl.
  `ws_auth_token` hash, `messages`, `events`, `artifacts`, `sandbox`, `ws_client_mapping`;
  schema `session/schema.ts`). Reached only via `env.SESSION.idFromName(sessionId)`; internal
  routes are `http://internal/internal/*` (not externally routable).
- `SchedulerDO` — single global, cron + `/automations/:id/trigger` only. Not client-facing.
- No per-user ownership check at the DO boundary beyond optional `userId` body fields. [O]
  (Single-tenant trust model — README security section.)

Cross-references: [[01-overview]] [[03-data-plane]] [[06-auth-and-tokens]]

# 03 — Data Plane (Modal) — what's behind the curtain

A mobile client never talks to Modal. This note records what constrains the client protocol.
**[O]** observed, **[I]** inferred. Findings via the modal-infra/sandbox-runtime sweep.

## Two channels, opposite initiators

1. **Control plane → Modal**: HTTPS request/response, HMAC-signed, to FastAPI endpoints
   (`api_create_sandbox`, `api_warm_sandbox`, `api_snapshot_sandbox`, `api_restore_sandbox`,
   `api_build_repo_image`, `api_health`) — `modal-infra/src/web_api.py`; client
   `control-plane/src/sandbox/client.ts`. Modal provider declares
   `supportsPersistentResume:false`, `supportsExplicitStop:false` (snapshot+restore only). [O]
2. **Sandbox → Control plane**: the agent process inside the sandbox opens an **outbound
   WebSocket** to `wss://<cp>/sessions/<id>/ws?type=sandbox` with
   `Authorization: Bearer <SANDBOX_AUTH_TOKEN>` + `X-Sandbox-ID`
   (`sandbox-runtime/.../bridge.py`). Same DO endpoint as clients; DO branches on
   `?type=sandbox` and validates the sandbox token (`durable-object.ts:864-923`). [O]

## Where the agent event stream originates

OpenCode runs as a local HTTP server in the sandbox (`localhost:4096`). The **bridge**:
- POSTs prompts to OpenCode and consumes its **Server-Sent Events** stream.
- Transforms SSE parts → bridge events (`token`, `tool_call`, `step_start`, `step_finish`,
  `tool_result`, `error`, `execution_complete`, ...).
- Sends them as JSON over its outbound WS to the `SessionDO`.

The DO (`session/sandbox-events.ts`) persists each to SQLite `events` and **broadcasts
`{type:"sandbox_event", event}`** to all connected client sockets. The schema is the
TypeScript `SandboxEvent` union in `shared/src/types/index.ts:167-268` (Python mirror in
`sandbox-runtime/.../types.py`). **A mobile client only implements the TS types.** [O]

Persistence nuances that affect mobile rendering:
- `token` events are **upserted/coalesced per messageId** — live stream sends growing
  cumulative text; replay returns only the final coalesced text. Client must handle both
  "append/replace cumulative" (live) and "final text" (replay). [O]
- `heartbeat` not persisted; incomplete `tool_call` not persisted. [O]
- Critical events (`execution_complete`, `error`, `snapshot_ready`, `push_*`) use ack +
  resend → **at-least-once**; clients must be idempotent (dedupe by event identity). [O]

## Replay & history (good news for mobile)

- On `subscribe`, DO sends `replay:{events, hasMore, cursor}` with up to **500** most-recent
  persisted events (`durable-object.ts:1226`, `getReplayData`; `REPLAY_LIMIT=500`). [O]
- Older history via `{type:"fetch_history", cursor, limit}` → `{type:"history_page", ...}`,
  rate-limited 1/200 ms, limit clamped 1–500. [O]
- **Not** a precise "events since offset" delta — it's "last 500" + manual backward
  pagination. A reconnecting mobile client must reconcile/dedupe by event id. [I]

## ttyd terminal

- `ttyd` (web terminal) on `127.0.0.1:7681`, only if `TERMINAL_ENABLED`. Fronted by a
  **JWT-authenticated reverse proxy** on port 7680, exposed via a Modal tunnel. [O]
- Auth: HS256 JWT signed with `SANDBOX_AUTH_TOKEN`, minted by the control plane
  (`sandbox/lifecycle/manager.ts`, TTL 86400 s). Delivered to clients via
  `{type:"ttyd_info", url, token}` and `SessionState.ttydUrl/ttydToken`. [O]
- **Transport is a raw WebSocket with the `tty` subprotocol**; the proxy authenticates via
  `?token=<jwt>`. The HTML/iframe injection is a browser convenience, **not** a protocol
  requirement. A native client *can* open `wss://<ttydUrl>/ws?token=<jwt>` with subprotocol
  `tty` and speak ttyd's binary framing (input/resize/base64) directly — non-trivial but
  not browser-bound. [I, well-supported]
- URL + token **rotate on every sandbox spawn/restore**; terminal scrollback never
  persists across snapshot/restore. [O]

## Code-server

Browser VS Code. Surfaced as `code_server_info {url,password}`. The web client renders an
**external link** (new tab), it does not iframe-embed. No native parity → external browser /
in-app WebView at best. [O] (see [[04-web-client]] feature table)

## Timeouts that matter for a backgrounded mobile app

- **Inactivity**: ~10 min default; +5 min extension only while ≥1 client connected. With
  **no client connected → timeout → snapshot → sandbox stopped**. Mobile backgrounding drops
  the socket → can accelerate teardown. [O]
- Heartbeat stale: missing 90 s → snapshot. Connecting watchdog 120 s. Per-prompt SSE
  inactivity 120 s; prompt max ~90 min; Modal sandbox lifetime default 7200 s. [O]
- Reconnecting to a `stopped`/`stale` sandbox WS → HTTP 410 (`durable-object.ts:881-892`);
  surfaces as "needs restore", triggered by sending a new prompt. [O]

## Resume / history

- Modal **filesystem snapshots** → Image ID persisted on the `sandbox` row. Restore creates a
  new sandbox from the snapshot (git clone skipped, OpenCode session reloaded), so the agent
  retains context. [O]
- **Agent/event history is recoverable from the control plane** (DO SQLite replay), *not*
  from the snapshot. **Terminal output is not recoverable** (new shell, new tunnel, new JWT
  on every restore). [O]

Cross-references: [[02-control-plane]] [[04-web-client]] [[07-gaps-and-blockers]]

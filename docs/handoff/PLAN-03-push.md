# PLAN 03 — Push Notifications (committed: Expo Push + gateway cron-poll)

> ← [[PLAN-00-overview]] · gateway [[PLAN-01-gateway]] · events [[PLAN-02-realtime-rn]] ·
> lifecycle facts [[03-data-plane]]. One mechanism, chosen (best/standard). No A/B.

## Why push is the headline feature

Premise is "fire and forget; check later" (`docs/HOW_IT_WORKS.md`). iOS suspends the WS in
background, so without push the user never learns a background session finished. No push
exists upstream — built entirely in the gateway as just-another-HMAC-client. Zero
`background-agents` changes.

## What to notify on

From `sandbox_event` (`packages/shared/src/types/index.ts:167-268`): inner
`execution_complete` (`success`, `error?`) — primary; inner `error`; `artifact_created`
(PR/screenshot); `session_status` terminal (`completed|failed|cancelled`); optionally
`child_session_update` terminal. Ignore `token|step_*|heartbeat` (too chatty).

## Mechanism (decided): gateway cron-poll → Expo Push

Chosen because it avoids long-lived sockets **and** the connected-client side-effect
(warning below), and Expo Push sidesteps the Worker→APNs HTTP/2 problem. ~≤60 s latency,
which is correct for a background-agent product.

Worker cron (`wrangler.toml [triggers] crons`, min 60 s). Loop over registered users'
tracked sessions, polling the existing REST surface with HMAC (no upstream change):

```ts
// gateway/src/push/poll.ts — sketch (scheduled handler)
for (const s of await registry.trackedSessions()) {           // from KV
  const { events, cursor } = await fetch(
    `${ENV.CONTROL_PLANE_URL}/sessions/${s.id}/events?cursor=${s.cursor ?? ""}&limit=50`,
    { headers: { Authorization: await authHeader(ENV.SECRET) } }).then(r=>r.json()); // router.ts:443
  const hit = events.find(e => e.type==="execution_complete" || e.type==="error"
                            || e.type==="artifact");
  if (hit && !await registry.alreadyNotified(s.id, hit))      // dedupe key below
    await expoPush(s.userId, summarize(hit, s));
  if (cursor) await registry.setCursor(s.id, cursor);          // advance only after send
}
```

Delivery — **Expo Push Service** (committed): app gets an Expo push token via
`expo-notifications` (needs the EAS `projectId` from `eas init`); `POST
${gatewayUrl}/push/register`. Gateway sends `POST https://exp.host/--/api/v2/push/send`
`{ to, title, body, data:{ sessionId } }`. Plain HTTPS, no certs/HTTP2. Tap → deep-link to
the session via `data.sessionId`. Prune tokens on Expo `DeviceNotRegistered` receipts.

> ⚠️ **Why polling, not a WS watcher.** Inactivity teardown ([[03-data-plane]]): a sandbox
> snapshots+stops on ~10 min idle, +5 min extension **only while ≥1 client WS is
> connected**. A watcher holding a WS *is* a connected client → suppresses idle teardown →
> **Modal cost ↑** and changed "session paused" UX for everyone. REST polling opens no
> client socket → none of that. (A per-user WS watcher is a *possible future* only if <60 s
> latency becomes a hard requirement, and only by accepting that cost — not in scope.)

## Registry & data model (committed: Cloudflare KV)

```
user:<sub>  -> { devices:[{ expoToken, addedAt }], sessions:{ <id>:{ cursor, notified:{} } } }
```
- `POST /push/register { expoToken }` (appJWT) → upsert device for `sub`.
- Tracked sessions = the user's non-terminal sessions (poll
  `GET /sessions?status=active` `router.ts:414-417`), capped per user.

## Idempotency

Events are at-least-once for criticals ([[PLAN-02-realtime-rn]]). Dedupe key
`(sessionId,messageId,type)`; advance the stored cursor only after a successful send → one
notification per completion even if cron re-runs / events resend.

## iOS specifics

`expo-notifications`: request permission on first session start (not app launch);
`getExpoPushTokenAsync({ projectId })`; notification-response listener deep-links to the
session. Remote push works while suspended (the whole point — no background socket). Group by
`sessionId` (thread id) so repeated updates to one session don't spam.

## Open policy decision (user owns — [[PLAN-05-config-and-risks]])

"Which sessions to watch": default = user's active sessions, capped. Change only if the user
wants explicit subscribe-on-open semantics. Cron fan-out is tiny for a single-tenant org.

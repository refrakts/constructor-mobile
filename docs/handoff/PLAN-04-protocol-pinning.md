# PLAN 04 — Protocol Vendoring, Pinning & Drift Alarm

> ← [[PLAN-00-overview]] · The price of "no upstream changes": you trade *git* conflicts for
> a *runtime contract* dependency. Manage it **early** (M0/M1). Background:
> [[05-shared-package]]. One monorepo → vendor **once** into `packages/protocol`, both
> `apps/*` consume it via the pnpm workspace.

## The coupling you actually have

`apps/mobile` and `apps/gateway` depend on the **shape and behavior** of
`@open-inspect/shared` types + the control-plane endpoints of the deployed version. Upstream
can change these with no merge conflict — runtime breaks. Three controls: **vendor**,
**pin**, **smoke test**.

## 1. Vendor the pure subset → `packages/protocol` (one copy, both apps)

`@open-inspect/shared` is `private:true`, ESM-only, single barrel, built `dist`
(`packages/shared/package.json:2-13`) — not installable cross-repo
([[05-shared-package]]). Vendor the **pure** subset (types erase; zero runtime deps; runs
unmodified on Hermes — verified by full sweep) into one workspace package both apps import:

`packages/protocol/` (workspace pkg, e.g. `@oi-mobile/protocol`):
- from `packages/shared/src/types/index.ts`: `SandboxEvent` (`:167-268`), `ClientMessage`
  (`:271-284`), `ServerMessage` (`:286-335`), `SessionState` (`:338-359`), session/message/
  artifact/`CreateSessionRequest`/automation interfaces.
- `packages/shared/src/models.ts` (model list / `VALID_MODELS` / reasoning config) — pickers.
- `packages/shared/src/git.ts` if surfacing branch naming.
- `packages/web/src/lib/access-control.ts` → used by `apps/gateway` (allowlist parity).
- `packages/shared/src/auth.ts:17-93` → used by `apps/gateway` (HMAC; copy so it can't drift).

`apps/mobile` imports the types/models; `apps/gateway` additionally imports
`access-control` + `auth`. **Do not** vendor `triggers/webhook/normalizer.ts`, Slack client,
`completion/extractor`, `cache-store`, Cloudflare-typed code — unneeded, and the only
Hermes-unsafe bits (`crypto.subtle`, `crypto.getRandomValues`) live there/in `auth.ts`
(which only `apps/gateway` — a Worker with `crypto.subtle` — runs, never `apps/mobile`).

Header on each vendored file:
```ts
// VENDORED from background-agents@<sha> :: packages/shared/src/types/index.ts
// Do not edit. Re-vendor via scripts/vendor-protocol.sh. Pinned: packages/protocol/PIN
```

## 2. Pin to a known control-plane version

`packages/protocol/PIN` records the upstream commit/tag the deployed control plane runs
(`background-agents@<sha>` + the `*.workers.dev` URL it maps to). Re-vendoring is a
deliberate PR. "Operator upgraded the control plane" = an explicit **re-validate mobile**
task.

```sh
# scripts/vendor-protocol.sh  (sketch; runs at monorepo root)
SHA="$1"; SRC=$(mktemp -d)
git clone --depth 1 https://github.com/<org>/background-agents "$SRC" && (cd "$SRC" && git checkout "$SHA")
cp "$SRC/packages/shared/src/types/index.ts"      packages/protocol/src/types.ts
cp "$SRC/packages/shared/src/models.ts"           packages/protocol/src/models.ts
cp "$SRC/packages/shared/src/auth.ts"             packages/protocol/src/auth.ts          # gateway-only
cp "$SRC/packages/web/src/lib/access-control.ts"  packages/protocol/src/access-control.ts # gateway-only
echo "background-agents@$SHA" > packages/protocol/PIN
# then: prepend VENDORED header, `pnpm -w run typecheck`, run contract smoke (below)
```

## 3. Contract smoke test (drift alarm) — also M0, run in CI + scheduled

Both the M0 de-risking spike and the permanent drift alarm. Exercises the live contract vs
the real deployed control plane via HMAC (creating a throwaway session is fine in non-prod).

```ts
// scripts/contract-smoke.ts — sketch; fail CI on any miss
// 1) POST /sessions {repoOwner,repoName,...}        -> 201 { sessionId }            router.ts:418
// 2) POST /sessions/:id/ws-token { userId,... }     -> 200 { token, participantId } router.ts:489
// 3) open wss://<wsUrl>/sessions/:id/ws ; send {type:"subscribe",token,clientId}
// 4) assert first msg.type==="subscribed" with .state (SessionState) and
//    .replay absent|{events:[],hasMore:boolean,cursor}
// 5) assert SandboxEvent/ServerMessage discriminant key-sets == vendored unions (diff)
// 6) DELETE /sessions/:id
// any shape/behavior mismatch => drift => fail with a diff
```
Run: CI for the monorepo, **and** scheduled against the target deployment (catches an
out-of-band control-plane upgrade).

## What this buys / residual risk

No git conflicts (you never touch `background-agents`); loud early failure on drift instead
of silent runtime breakage; one greppable `PIN`. **Residual:** behavioral drift a type diff
won't catch (close-code meanings, replay limit, token-coalescing) — only the *behavioral*
assertions (steps 3–5) catch these; invest there, not just type-shape checks. Surface in
[[PLAN-05-config-and-risks]].

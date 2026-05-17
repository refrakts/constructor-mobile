# Mobile UI — Core-Loop Buildout (Design Spec)

> Date: 2026-05-17 · Branch: `build/mobile-ui` · Status: **approved-async**.
> The user approved approach A and said "split multitask it, I'll be back" — the
> interactive brainstorming approval gate is replaced by **this committed spec**
> (revertable in one commit) per advisor guidance. Companion: `docs/handoff/PLAN-00..05`.

## 1. Locked decisions (do not re-open)

- This is a **parallel UI track**. The backend track (live half of Step B, **M0**,
  M1–M5) is deferred until `ColeMurray/background-agents@a7b968f` is deployed. M0
  remains a hard gate before any milestone that talks to a live backend.
- **Approach A** — screens consume a typed `SessionGateway` interface (typed to the
  vendored `@constructor/protocol`) via TanStack Query hooks + pure stream transforms
  ported verbatim from upstream. First impl = `MockSessionGateway`. The real HTTP/WS
  impl implements the *same* interface later with **zero screen changes**.
- **Committed stack — no substitutions**: Expo SDK 55, Expo Router (typed routes, new
  arch), `@expo/ui`, `@shopify/flash-list`, `react-native-markdown-display`,
  `@tanstack/react-query`, `expo-secure-store`, `expo-auth-session`. TanStack DB is
  being *evaluated only* (§8 research task) — not adopted.
- All commits **GPG-signed** (key `A042A593BA4590F689306DB4DDF5625FBAE7A006`),
  identity `Nejc Drobnic <nejc@nejc.dev>`, **NO `Co-Authored-By` trailer and NO
  assistant/tool attribution of any kind** (overrides default tooling — applies to
  every commit and every dispatched subagent). Stop if signing fails.
- `apps/mobile/AGENTS.md` hard rule: **read https://docs.expo.dev/versions/v55.0.0/
  before writing any mobile code**; use Context7 MCP for any uncertain library API.

## 2. The visual-target reality (important)

`@expo/ui` renders native SwiftUI and **does not work in Expo Go**. While the user is
away we cannot drive an EAS build (their Apple/EAS auth). What they will open on
return is **Expo Go via QR**. Therefore:

- **Primary visual target = the plain-RN fallback inside `src/ui/`**, fully styled to
  a polished native-iOS feel. This is not a degraded mode; it is *the* deliverable.
- `@expo/ui` SwiftUI is the *enhancement* path behind a safe capability check (must
  never crash Expo Go). A precise `eas build --profile development` runbook is left
  for the user to unlock the SwiftUI chrome.

## 3. File map & ownership

```
packages/protocol/                     [Phase 0 ONLY]  vendored shared types @ a7b968f
  PIN                                  ref: + url: pending-deploy
  src/{types,models,...}.ts            // VENDORED headers
apps/mobile/src/
  ui/                                  [Phase 0; FROZEN in Phase 1 — slices READ only]
    index.ts, primitives, theme glue, @expo/ui capability shim
  data/                                [Phase 0; FROZEN in Phase 1 — slices READ only]
    gateway.ts        SessionGateway interface (typed to @constructor/protocol)
    provider.tsx      GatewayProvider + QueryClient
    queries.ts        TanStack Query hooks (keyed by activeProfileId)
    mock/{fixtures,emitter,mock-gateway}.ts
  features/sessions/stream/transforms.ts   [Phase 0] PORTED pure transforms (marker)
  features/<slice>/**                  [Phase 1 — exactly one slice agent owns each]
  app/**                               [Phase 0 pre-creates thin route wrappers]
  constants/theme.ts                   [Phase 0; FROZEN in Phase 1]
```

**Ownership rules (parallelization safety):**

1. **Phase 0 owns ALL `package.json` / `pnpm-lock.yaml` edits.** A slice agent that
   thinks it needs a new dependency **HALTS and reports** — never `pnpm add` in a slice.
2. Route files under `src/app/` are pre-created in Phase 0 as thin wrappers that
   `import` from `src/features/<slice>/screen.tsx`. Slice agents edit **only**
   `src/features/<slice>/**`.
3. **Frozen during Phase 1** (slice agents READ, never EDIT): `src/ui/**`,
   `src/constants/theme.ts`, `src/data/**`, `features/sessions/stream/transforms.ts`,
   `packages/protocol/**`, `src/app/**`.
4. No cross-slice imports. If the shared contract feels too thin, the slice agent
   **HALTS and reports** rather than widening it locally.

## 4. `SessionGateway` contract (Phase 0 owns; reconcile to vendored names)

Conceptual shape (exact protocol type names confirmed when vendored in Phase 0; the
interface is Phase-0-owned and reconciled there before fan-out):

```ts
import type {
  Session, SessionState, SandboxEvent, CreateSessionRequest,
} from "@constructor/protocol";

export type StreamHandle = { unsubscribe(): void };

export interface SessionGateway {
  listSessions(): Promise<Session[]>;
  getSession(id: string): Promise<SessionState>;
  createSession(req: CreateSessionRequest): Promise<{ sessionId: string }>;
  /** Mirrors real DO: emits `subscribed` (state + replay{events,hasMore,cursor})
   *  then a stream of SandboxEvent, then terminal status. */
  subscribe(id: string, on: (e: SandboxEvent) => void): StreamHandle;
  sendFollowUp(id: string, text: string): Promise<void>;
  stop(id: string): Promise<void>;
}
```

Screens never touch the gateway directly — only via `data/queries.ts` hooks
(`useSessions`, `useSession`, `useCreateSession`, `useSessionStream`, …), all keyed by
`activeProfileId` so profiles never bleed (PLAN-02).

## 5. Mock contract & scripted scenario

The mock obeys the **real subscribe shape** so screens behave as the real Durable
Object will (no post-M0 rework): `subscribe` → `{ type:"subscribed", state,
replay:{events,hasMore,cursor} }` → ordered `SandboxEvent` stream → terminal.

**Scenario A (happy path)** — bind discriminant names to the vendored union in Phase 0:

1. `subscribed` with `state.status = "running"`, `replay.events = []`, `hasMore:false`.
2. user prompt echoed → assistant "thinking" indicator.
3. `tool_call` started: `write_file src/App.tsx` → `tool_output` (success).
4. token stream for one `messageId`: ~20 token events, **cumulative live / coalesced
   on replay** (transforms.ts handles folding) rendered as growing markdown.
5. `message` finalized for that `messageId`.
6. terminal `status = "completed"`.

**Scenario B (short)**: prompt → tool error → `status = "error"` (drives the error UI).

Emitter replays Scenario A by default with realistic 40–120 ms inter-token timing so
FlashList streaming/`maintainVisibleContentPosition` is exercised.

## 6. Slices (Phase 1 — one agent each, disjoint dirs)

| Slice | Route | Feature dir | Gateway/hooks | Required states |
|---|---|---|---|---|
| Profiles/Settings | `/(settings)` | `features/profiles` | profile store (AsyncStorage) + secure-store stub | empty/first-run, list, add/edit/delete, set-active |
| Sign-in shell | `/sign-in` | `features/auth` | mock auth toggle (no real OAuth) | signed-out, in-progress, signed-in |
| Session list | `/(app)/index` | `features/sessions/list` | `useSessions` | loading, empty, populated, error, pull-to-refresh |
| Create session | `/(app)/new` | `features/sessions/create` | `useCreateSession`, `VALID_MODELS` | form, validation, submitting, success→navigate |
| Session detail / stream | `/(app)/s/[id]` | `features/sessions/detail` | `useSession` + `useSessionStream` | connecting, replay, live stream, follow-up composer, stop, completed/error |

All slices: native-iOS feel via `src/ui` wrapper (never import `@expo/ui` directly),
light/dark via `constants/theme.ts`, typecheck-clean for their files, polished empty/
loading/error states (no raw spinners-on-white).

## 7. Phases

- **Phase 0 (sequential, parent):** branch ✓ → vendor `@constructor/protocol`
  @ `a7b968f` (clone, resolve full 40-char SHA, copy pure subset, `// VENDORED`
  headers, structured `PIN`: `ref: background-agents@<full-sha>` + `url:
  pending-deploy`) → `src/ui` wrapper (RN-primary + `@expo/ui` shim) → data layer
  (gateway, mock, emitter, provider, queries) → port pure transforms (marker:
  `// Ported from background-agents/packages/web/src/hooks/use-session-socket.ts:63-99,227-274 @ <full-sha>`)
  → Expo Router shell + theme + route stubs. **EXIT GATE: `pnpm -w typecheck` clean
  AND `expo export`/Metro bundle succeeds.** Signed commit. *Do not dispatch Phase 1
  until the exit gate is green.*
- **Phase 1 (parallel):** 5 slice agents (disjoint dirs, rules §3) + 1 read-only
  TanStack DB research agent. Each gets AGENTS.md verbatim + this spec.
- **Phase 2:** integrate, `pnpm -w typecheck` + `expo lint`, confirm Expo-Go
  loadable, write EAS dev-build runbook, signed commits, verification-before-
  completion, written status report for the user's return.

## 8. TanStack DB research (read-only, no edits)

Evaluate https://tanstack.com/db/latest/docs/overview#react-native — output: (a) RN
support reality, (b) fit with socket-stream + protocol-typed + mock-seam architecture,
(c) cost-to-adopt vs current TanStack Query, (d) what Query already gives us that DB
doesn't. **Do not adopt** (committed stack) — surface a recommendation for user decision.

## 9. Success criteria

- App loads in **Expo Go via QR**; core loop navigable end-to-end on mock data;
  polished native-feel RN UI; light + dark.
- `@expo/ui` SwiftUI path present behind dev build; runbook provided.
- `pnpm -w typecheck` and `expo lint` clean.
- `packages/protocol` vendored @ `a7b968f`, structured `PIN` (`url: pending-deploy`).
- Every commit signed + verified (`git log --show-signature`), no attribution trailer.

## 10. Deferred / NOT in scope

M0 + live contract assertions, `PIN` url, real OAuth/auth, real network/WS transport,
history/resume, repo secrets, automations, screenshots, push. (Later slices / gated on
the `a7b968f` deployment.)

## 11. Open risks

- `@expo/ui` alpha coverage → mitigated: RN-primary wrapper, one-file swaps.
- Vendored protocol type names may differ from handoff sketches → Phase 0 reconciles
  the `SessionGateway`/transforms against the real union *before* fan-out.
- Mock scenario must match the real DO contract shape so screens need no post-M0
  rework → emitter mirrors `subscribed`/`replay` exactly.

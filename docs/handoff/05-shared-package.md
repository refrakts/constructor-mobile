# 05 — `@open-inspect/shared`: portability to React Native

Verified against `packages/shared/package.json`, `src/index.ts`, `src/auth.ts`,
`src/types/index.ts`. **[O]** observed, **[I]** inferred.

## What it is / packaging

- `package.json` [O]: `name "@open-inspect/shared"`, `version 0.1.0`, **`"private": true`**,
  `"type": "module"` (pure ESM), `main: dist/index.js`, `types: dist/index.d.ts`, single
  `exports["."]` → `{import: ./dist/index.js, types: ./dist/index.d.ts}` (**no subpath
  exports**). Runtime deps: `@octokit/webhooks-types` (types-only), `cron-parser` (real).
  Built with `tsc`; consumed by siblings as `"@open-inspect/shared": "file:../shared"`
  against built `dist`. Not published.
- Barrel `src/index.ts` re-exports: `types`, `git`, `auth`, `models`, `cron`, `triggers`,
  `completion/extractor`, `logger`, `cache-store`, `app-name`, `slack`. [O]

## The high-value, fully portable subset (for a mobile client)

These are the WS wire contract + DTOs + model list a mobile app actually needs, and they are
**pure TypeScript with zero runtime/platform deps** (types erase at compile time):

- `src/types/index.ts` — `SandboxEvent` (`:167-268`), `ClientMessage` (`:271-284`),
  `ServerMessage` (`:286-335`), `SessionState` (`:338-359`), plus all session / message /
  artifact / API-request / analytics / automation interfaces. [O — read directly]
- `src/types/integrations.ts`, `src/triggers/types.ts` — enums/consts.
- `src/models.ts` — `VALID_MODELS`, `MODEL_OPTIONS`, `MODEL_REASONING_CONFIG`,
  `DEFAULT_MODEL`, `DEFAULT_ENABLED_MODELS` + pure helpers (`normalizeModelId`,
  `isValidModel`, `supportsReasoning`, …). Pure string/object logic.
- `src/git.ts` (branch-name helpers), `src/slack/mrkdwn.ts` (string sanitizers),
  `src/app-name.ts`, `src/triggers/{glob,conditions}.ts`, `src/logger.ts` (console only).

No `node:*`, no `fs/path/stream/Buffer/process`, no DOM globals, no
`@cloudflare/workers-types`, no `DurableObject`/`KVNamespace` anywhere in the package.
`cache-store.ts` and `completion/extractor.ts` deliberately duck-type their deps to avoid
Cloudflare imports. [O — corroborated by file-by-file sweep]

## The only runtime blockers (both isolated to function bodies)

1. **`src/auth.ts` crypto** — `computeHmacHex`/`generateInternalToken`/
   `buildInternalAuthHeaders`/`verifyInternalToken` use **Web Crypto `crypto.subtle`** +
   `new TextEncoder()` (verified `auth.ts:38-51,63-93`). Hermes has no `crypto.subtle` and
   no native `TextEncoder`. **But:** these are inside async function bodies, so merely
   `import`ing the barrel does **not** crash — only *calling* them does. And a mobile client
   should not be signing internal HMAC tokens or verifying webhook signatures at all (server
   concern). If client-side internal-token signing is ever needed, reimplement HMAC-SHA256
   with `@noble/hashes` (~20 lines) or polyfill (`react-native-quick-crypto`). `TextEncoder`
   is auto-polyfilled by modern Expo. [O + I]
2. **`triggers/webhook/normalizer.ts` `generateDeliveryId`** — `crypto.getRandomValues`;
   needs `react-native-get-random-values` if ever called (server concern; usually not). [I]

`timingSafeEqual` (`auth.ts:17-26`) is pure and reusable as-is. [O]

## Consuming it from a separate Expo repo — options

| Option | Viability |
|---|---|
| `npm install @open-inspect/shared` | **Blocked** — `private:true`, not published. Would require removing `private` + publishing (incl. `dist`). |
| Git/tarball dependency | Workable but fragile — `dist/` is git-ignored build output; needs a `prepare` build + `cron-parser` resolution; ESM-only single `import` condition needs Metro package-exports support. |
| Git submodule + path dep | Heavy; same build/Metro caveats. |
| **Copy-vendor the pure subset** (`src/types/**`, `models.ts`, `git.ts`, protocol/enum files) | **Recommended.** Zero deps, zero platform APIs → compiles/runs unmodified on Hermes; sidesteps the ESM/Metro and `private` issues entirely. Best for v1; revisit a published `@open-inspect/shared-protocol` later for drift control. [I] |

## Verdict

- **Protocol/types/models: 100% portable**, by copy-vendor today or a published protocol
  package later. This is the main value and it is essentially free.
- **`auth.ts` crypto: not needed on device** for the recommended architecture (the BFF holds
  the HMAC secret). If ever needed client-side, small reimplementation.
- The real cost is **drift management** between two repos, not technical incompatibility — a
  thin, versioned protocol package is the long-term fix. [I]

Cross-references: [[02-control-plane]] [[04-web-client]] [[06-auth-and-tokens]]
[[FINAL-feasibility]]

# Gateway Terraform (Cloudflare IaC) — Design Spec

> Date: 2026-05-17 · Branch: `build/mobile-ui` · Status: **approved (gates
> compressed per user: "ok for now, patch misconceptions later")**. Plan folded
> in below; no separate writing-plans round-trip. Reference:
> `.upstream/background-agents/terraform` (vendored clone, gitignored).

## 1. Goal & decisions

Provide Infrastructure-as-Code for the **mobile gateway only** (PLAN-01: a single
Cloudflare Worker, public-URL + HMAC, KV store, `jose`), mirroring
background-agents' Terraform *pattern* scoped to that one Worker.

User-chosen forks:
1. **Full mirror** — Terraform owns build **and** deploy of the gateway Worker
   (`cloudflare_worker` + `cloudflare_worker_version` + `cloudflare_workers_deployment`).
   `apps/gateway/wrangler.jsonc` is kept for `wrangler dev` (local) and as the
   build input only — **not** for deploy.
2. **R2 S3 state backend** — `backend "s3"` on Cloudflare R2, same shape as
   background-agents; creds via `-backend-config=backend.tfvars`.
3. **Secrets as TF vars → `secret_text` bindings** — they land in TF state;
   state lives in a **private** R2 bucket and is treated sensitive.

## 2. Layout (mirror, scoped)

```
terraform/
  README.md                      init/plan/apply runbook
  modules/
    cloudflare-kv/      main.tf variables.tf outputs.tf versions.tf
    cloudflare-worker/  main.tf variables.tf outputs.tf versions.tf  (trimmed to KV + plain_text + secrets)
  environments/production/
    versions.tf         terraform >= 1.14; cloudflare ~> 5.16; provider api_token = var.cloudflare_api_token
    backend.tf          backend "s3" (R2): bucket constructor-gateway-tfstate, key production/terraform.tfstate,
                        region "auto", skip_* R2 flags; creds via backend.tfvars
    backend.tfvars.example
    variables.tf        cloudflare_account_id, cloudflare_api_token (sensitive), project_root,
                        name_suffix, control_plane_url, ws_url, + sensitive secret vars
    locals.tf           worker_name, built script path, url passthroughs
    kv.tf               module gateway_kv → cloudflare-kv (constructor-gateway-kv-${name_suffix})
    worker-gateway.tf   null_resource build (local-exec) → module gateway_worker (KV binding +
                        plain_text [CONTROL_PLANE_URL, WS_URL] + secret_text [INTERNAL_CALLBACK_SECRET,
                        GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET, APP_JWT_SIGNING_KEY,
                        EXPO_ACCESS_TOKEN]); workers.dev subdomain enabled
    outputs.tf          worker_name, workers_dev_url, kv_namespace_id
    checks.tf           check block: required secret vars non-empty
    moved.tf            placeholder (parity / future state moves)
    terraform.tfvars.example
```

Modules are adapted from `background-agents/terraform/modules/{cloudflare-kv,
cloudflare-worker}`; the worker module is trimmed to the binding types we use
(KV, plain_text, secret_text) — D1/R2/Durable-Object/service-binding inputs
dropped (YAGNI; not used by the gateway).

## 3. Build / deploy flow

`null_resource.gateway_build` runs `local-exec`:
`pnpm --filter gateway run build` where the gateway gets a `build` script
`wrangler deploy --dry-run --outdir dist` (produces the bundled worker without
deploying). `locals.gateway_script_path` points at the emitted bundle;
`cloudflare_worker_version` uploads it; `cloudflare_workers_deployment` promotes
it. `wrangler.jsonc` (`nodejs_compat`, `compatibility_date`) is the build input;
TF carries the matching `compatibility_date`/flags into the worker version.

## 4. Secret hygiene (mandatory)

Since secrets flow through tfvars → state, `.gitignore` is extended repo-wide:
`*.tfvars`, `*.tfvars.json`, `!*.tfvars.example`, `*.tfstate`, `*.tfstate.*`,
`.terraform/`, `.terraform.lock.hcl` is **committed** (pinned providers, like
background-agents), `crash.log`, `crash.*.log`. Real values live only in
local `terraform.tfvars` + `backend.tfvars` and in the private R2 state bucket.
`.upstream/` (the reference clone) is already gitignored.

## 5. Explicitly out of scope

D1, R2 *buckets* (R2 is only the TF state backend), Durable Objects, Modal,
Vercel, Daytona, slack/github/linear workers, web-*. Those are control-plane /
background-agents and violate PLAN-00's zero-coupling constraint if added here.
Custom domain / `zone_id` route is supported by the module but **deferred**
(gateway uses `*.workers.dev`; the app only needs the gateway URL per PLAN-02).

## 6. Implementation phases

1. `.gitignore` hardening (TF state/tfvars patterns) — do first so nothing leaks.
2. `apps/gateway/package.json`: add `build` script for the `local-exec`.
3. `terraform/modules/cloudflare-kv/*` (port ~verbatim).
4. `terraform/modules/cloudflare-worker/*` (port + trim; verify the v5
   `cloudflare_worker*` resource schema against the vendored reference module).
5. `terraform/environments/production/*` (versions, backend, variables, locals,
   kv, worker-gateway, outputs, checks, moved, tfvars examples).
6. `terraform/README.md` runbook.
7. `terraform fmt -recursive` if the CLI is present; otherwise careful authoring.
8. Signed commit + push.

## 7. Success criteria

- `terraform/` mirrors background-agents' structure, scoped to one Worker + KV.
- No secrets/state committed; `.gitignore` covers TF artifacts; verified by a
  tracked-file sweep before push.
- `README.md` documents the exact `terraform init -backend-config=backend.tfvars`
  → `plan` → `apply` runbook and the one-time R2 bucket/token setup.
- HCL is well-formed (`terraform fmt`/`validate` clean if CLI available).
- I do **not** run `terraform`/`wrangler` (needs the user's CF account, API
  token, and R2 bucket) — IaC + runbook only; user runs `init/plan/apply`.

## 8. Known iteration points ("patch later")

The Cloudflare Terraform provider v5 `cloudflare_worker*` resource schema is
fast-moving; the worker module is ported from the vendored reference at
`a7b968f` and may need field tweaks when the user first runs `terraform plan`.
Compatibility date/flags must stay in sync with `apps/gateway/wrangler.jsonc`.
These are expected patch points, not blockers.

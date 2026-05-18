# --- Cloudflare account / auth ------------------------------------------------
variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token (Workers Scripts + KV + Workers Routes edit)"
  type        = string
  sensitive   = true
}

# --- deployment ---------------------------------------------------------------
variable "project_root" {
  description = "Absolute path to the monorepo root (so the build local-exec can pnpm --filter gateway)"
  type        = string
}

variable "name_suffix" {
  description = "Suffix for resource names (e.g. prod, staging)"
  type        = string
  default     = "prod"
}

variable "compatibility_date" {
  description = "Worker compatibility date — keep in sync with apps/gateway/wrangler.jsonc"
  type        = string
  default     = "2026-05-16"
}

variable "compatibility_flags" {
  description = "Worker compatibility flags"
  type        = list(string)
  default     = ["nodejs_compat"]
}

variable "push_cron" {
  description = "Cron schedule(s) for the gateway scheduled handler. Empty = disabled."
  type        = list(string)
  default     = ["*/2 * * * *"]
}

variable "workers_dev_subdomain" {
  description = "Cloudflare account workers.dev subdomain, required when gateway_custom_domain is not set"
  type        = string
  default     = null
}

# --- optional custom domain ---------------------------------------------------
variable "zone_id" {
  description = "Cloudflare zone ID (only needed if gateway_custom_domain is set)"
  type        = string
  default     = null
}

variable "gateway_custom_domain" {
  description = "Optional custom domain for the gateway (else *.workers.dev)"
  type        = string
  default     = null
}

# --- non-secret gateway config (plain_text bindings) --------------------------
variable "control_plane_url" {
  description = "Deployed control-plane base URL (background-agents)"
  type        = string
}

variable "ws_url" {
  description = "Control-plane WebSocket base URL (returned to the app via GET /config)"
  type        = string
}

variable "github_oauth_client_id" {
  description = "Mobile GitHub OAuth App client id (not secret)"
  type        = string
}

# --- secrets (TF vars → secret_text bindings; land in state — keep R2 private) -
variable "internal_callback_secret" {
  description = "Shared HMAC secret with the control plane (god-mode)"
  type        = string
  sensitive   = true
}

variable "github_oauth_client_secret" {
  description = "Mobile GitHub OAuth App client secret"
  type        = string
  sensitive   = true
}

variable "app_jwt_signing_key" {
  description = "Gateway-owned key used to sign short-lived app-session JWTs"
  type        = string
  sensitive   = true
}

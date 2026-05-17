variable "account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "zone_id" {
  description = "Cloudflare zone ID (required only for custom domain / route)"
  type        = string
  default     = null
}

variable "worker_name" {
  description = "Name of the worker"
  type        = string
}

variable "script_path" {
  description = "Path to the bundled ES-module worker script (produced by the build step)"
  type        = string
}

variable "kv_namespaces" {
  description = "KV namespace bindings"
  type = list(object({
    binding_name = string
    namespace_id = string
  }))
  default = []
}

variable "plain_text_bindings" {
  description = "Plain-text environment variable bindings (non-secret config)"
  type = list(object({
    name  = string
    value = string
  }))
  default = []
}

variable "secrets" {
  description = "Secret-text bindings (values land in TF state — keep state private)"
  type = list(object({
    name  = string
    value = string
  }))
  default   = []
  sensitive = true
}

variable "cron_triggers" {
  description = "Cron expressions for the worker scheduled() handler (push cron-poll)"
  type        = list(string)
  default     = []
}

variable "compatibility_date" {
  description = "Worker compatibility date (keep in sync with apps/gateway/wrangler.jsonc)"
  type        = string
}

variable "compatibility_flags" {
  description = "Worker compatibility flags (e.g. [\"nodejs_compat\"])"
  type        = list(string)
  default     = []
}

variable "custom_domain" {
  description = "Optional custom domain hostname for the worker"
  type        = string
  default     = null
}

variable "route_pattern" {
  description = "Optional zone route pattern for the worker"
  type        = string
  default     = null
}

# Cloudflare KV Namespace module (adapted from background-agents/terraform).
resource "cloudflare_workers_kv_namespace" "this" {
  account_id = var.account_id
  title      = var.namespace_name
}

# Gateway KV namespace: push registry + per-session cursors + hashed refresh
# tokens (PLAN-01 / PLAN-03).
module "gateway_kv" {
  source = "../../modules/cloudflare-kv"

  account_id     = var.cloudflare_account_id
  namespace_name = local.kv_name
}

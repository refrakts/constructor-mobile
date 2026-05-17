# Build the gateway bundle before deploy (TF owns build+deploy; wrangler.jsonc
# is only the build input + `wrangler dev`, never the deploy mechanism).
resource "null_resource" "gateway_build" {
  triggers = {
    always_run = timestamp()
  }

  provisioner "local-exec" {
    command     = "pnpm --filter gateway run build"
    working_dir = var.project_root
  }
}

module "gateway_worker" {
  source = "../../modules/cloudflare-worker"

  account_id          = var.cloudflare_account_id
  worker_name         = local.worker_name
  script_path         = local.gateway_script_path
  compatibility_date  = var.compatibility_date
  compatibility_flags = var.compatibility_flags

  kv_namespaces = [
    {
      binding_name = "GATEWAY_KV"
      namespace_id = module.gateway_kv.namespace_id
    }
  ]

  plain_text_bindings = [
    { name = "CONTROL_PLANE_URL", value = var.control_plane_url },
    { name = "WS_URL", value = var.ws_url },
    { name = "GITHUB_OAUTH_CLIENT_ID", value = var.github_oauth_client_id },
  ]

  secrets = [
    { name = "INTERNAL_CALLBACK_SECRET", value = var.internal_callback_secret },
    { name = "GITHUB_OAUTH_CLIENT_SECRET", value = var.github_oauth_client_secret },
    { name = "APP_JWT_SIGNING_KEY", value = var.app_jwt_signing_key },
    { name = "EXPO_ACCESS_TOKEN", value = var.expo_access_token },
  ]

  cron_triggers = var.push_cron

  zone_id       = var.zone_id
  custom_domain = var.gateway_custom_domain

  depends_on = [null_resource.gateway_build]
}

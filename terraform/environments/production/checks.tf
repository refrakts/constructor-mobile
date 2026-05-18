# Fail fast if required config/secrets are blank (parity with background-agents).
check "required_inputs" {
  assert {
    condition = (
      length(trimspace(var.internal_callback_secret)) > 0 &&
      length(trimspace(var.app_jwt_signing_key)) > 0 &&
      length(trimspace(var.github_oauth_client_secret)) > 0 &&
      length(trimspace(var.cloudflare_account_id)) > 0 &&
      length(trimspace(var.cloudflare_api_token)) > 0 &&
      length(trimspace(var.github_oauth_client_id)) > 0 &&
      length(trimspace(var.control_plane_url)) > 0 &&
      length(trimspace(var.ws_url)) > 0 &&
      (var.gateway_custom_domain != null || (var.workers_dev_subdomain != null && length(trimspace(var.workers_dev_subdomain)) > 0))
    )
    error_message = "Required Cloudflare, OAuth, gateway, and secret inputs must be set. workers_dev_subdomain is required unless gateway_custom_domain is set."
  }
}

# Fail fast if required config/secrets are blank (parity with background-agents).
check "required_inputs" {
  assert {
    condition = (
      length(trimspace(var.internal_callback_secret)) > 0 &&
      length(trimspace(var.app_jwt_signing_key)) > 0 &&
      length(trimspace(var.github_oauth_client_secret)) > 0 &&
      length(trimspace(var.control_plane_url)) > 0 &&
      length(trimspace(var.ws_url)) > 0
    )
    error_message = "internal_callback_secret, app_jwt_signing_key, github_oauth_client_secret, control_plane_url and ws_url must all be set in terraform.tfvars."
  }
}

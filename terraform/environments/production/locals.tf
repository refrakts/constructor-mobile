locals {
  worker_name = "constructor-gateway-${var.name_suffix}"
  kv_name     = "constructor-gateway-kv-${var.name_suffix}"

  gateway_dir = "${var.project_root}/apps/gateway"
  # `wrangler deploy --dry-run --outdir dist` (the gateway `build` script) emits
  # the bundled ES module here.
  gateway_script_path = "${local.gateway_dir}/dist/index.js"
}

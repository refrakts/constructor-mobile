# Cloudflare Worker module — adapted from background-agents/terraform, trimmed to
# the bindings the gateway uses (KV + plain_text + secret_text + cron).
# 3-resource pattern: cloudflare_worker + cloudflare_worker_version + cloudflare_workers_deployment.

locals {
  bindings = concat(
    [for kv in var.kv_namespaces : {
      type         = "kv_namespace"
      name         = kv.binding_name
      namespace_id = kv.namespace_id
    }],
    [for pt in var.plain_text_bindings : {
      type = "plain_text"
      name = pt.name
      text = pt.value
    }],
    [for sec in var.secrets : {
      type = "secret_text"
      name = sec.name
      text = sec.value
    }],
  )
}

resource "cloudflare_worker" "this" {
  account_id = var.account_id
  name       = var.worker_name

  subdomain = {
    enabled = true
  }

  observability = {
    enabled            = true
    head_sampling_rate = 1
    logs = {
      enabled            = true
      head_sampling_rate = 1
      invocation_logs    = true
    }
  }
}

resource "cloudflare_worker_version" "this" {
  account_id          = var.account_id
  worker_id           = cloudflare_worker.this.id
  compatibility_date  = var.compatibility_date
  compatibility_flags = var.compatibility_flags

  main_module = "index.js"

  modules = [
    {
      name         = "index.js"
      content_type = "application/javascript+module"
      content_file = var.script_path
    }
  ]

  bindings = local.bindings
}

resource "cloudflare_workers_deployment" "this" {
  account_id  = var.account_id
  script_name = cloudflare_worker.this.name
  strategy    = "percentage"

  versions = [
    {
      percentage = 100
      version_id = cloudflare_worker_version.this.id
    }
  ]
}

resource "cloudflare_workers_custom_domain" "this" {
  count = var.custom_domain != null ? 1 : 0

  account_id = var.account_id
  zone_id    = var.zone_id
  hostname   = var.custom_domain
  service    = cloudflare_worker.this.name
}

resource "cloudflare_workers_route" "this" {
  count = var.route_pattern != null ? 1 : 0

  zone_id = var.zone_id
  pattern = var.route_pattern
  script  = cloudflare_worker.this.name
}

resource "cloudflare_workers_cron_trigger" "this" {
  count = length(var.cron_triggers) > 0 ? 1 : 0

  account_id  = var.account_id
  script_name = cloudflare_worker.this.name
  schedules   = [for expr in var.cron_triggers : { cron = expr }]

  depends_on = [cloudflare_workers_deployment.this]
}

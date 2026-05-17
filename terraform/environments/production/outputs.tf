output "gateway_worker_name" {
  description = "Deployed gateway worker name"
  value       = module.gateway_worker.worker_name
}

output "gateway_url" {
  description = "Gateway URL (custom domain if set, else workers.dev). Enter this as the connection-profile gateway URL in the app."
  value       = coalesce(module.gateway_worker.custom_domain, module.gateway_worker.worker_url)
}

output "gateway_kv_namespace_id" {
  description = "KV namespace id bound to the gateway as GATEWAY_KV"
  value       = module.gateway_kv.namespace_id
}

output "worker_name" {
  description = "Name of the deployed worker"
  value       = cloudflare_worker.this.name
}

output "worker_id" {
  description = "ID of the worker"
  value       = cloudflare_worker.this.id
}

output "version_id" {
  description = "ID of the current worker version"
  value       = cloudflare_worker_version.this.id
}

output "deployment_id" {
  description = "ID of the deployment"
  value       = cloudflare_workers_deployment.this.id
}

output "worker_url" {
  description = "Default workers.dev URL (actual subdomain varies by account)"
  value       = "https://${cloudflare_worker.this.name}.workers.dev"
}

output "custom_domain" {
  description = "Custom domain (if configured)"
  value       = var.custom_domain != null ? cloudflare_workers_custom_domain.this[0].hostname : null
}

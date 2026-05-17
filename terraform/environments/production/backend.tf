# Terraform state backend — Cloudflare R2 (S3-compatible), mirrors background-agents.
#
# One-time setup:
#   1. wrangler r2 bucket create constructor-gateway-tfstate
#   2. Cloudflare dashboard → R2 → Manage R2 API Tokens → create a read/write token
#   3. cp backend.tfvars.example backend.tfvars  (gitignored) and fill it in
#   4. terraform init -backend-config=backend.tfvars
#
# State is sensitive (secrets are stored as secret_text bindings → state). Keep
# the R2 bucket PRIVATE.

terraform {
  backend "s3" {
    bucket = "constructor-gateway-tfstate"
    key    = "production/terraform.tfstate"
    region = "auto"

    # access_key / secret_key / endpoints supplied via -backend-config=backend.tfvars

    # R2 compatibility
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
  }
}

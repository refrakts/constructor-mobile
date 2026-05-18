#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

info "Enabling pnpm via corepack"
corepack enable

info "Installing dependencies from pnpm-lock.yaml"
pnpm install --frozen-lockfile

info "Building gateway to warm generated artifacts"
pnpm --filter gateway build

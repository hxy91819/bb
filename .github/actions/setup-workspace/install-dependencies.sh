#!/usr/bin/env bash
set -euo pipefail

if [[ "${PNPM_CACHE_RESTORE_OUTCOME:-success}" != "success" && "${PNPM_CACHE_RESTORE_OUTCOME:-success}" != "skipped" ]]; then
  echo "::warning::pnpm cache restoration failed; using a fresh dependency store."
  export PNPM_CONFIG_STORE_DIR
  PNPM_CONFIG_STORE_DIR=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/bb-pnpm-fallback.XXXXXX")
  if [[ -n "${GITHUB_ENV:-}" ]]; then
    echo "PNPM_CONFIG_STORE_DIR=$PNPM_CONFIG_STORE_DIR" >> "$GITHUB_ENV"
  fi
fi

if [[ "${TURBO_CACHE_RESTORE_OUTCOME:-success}" != "success" && "${TURBO_CACHE_RESTORE_OUTCOME:-success}" != "skipped" ]]; then
  echo "::warning::Turbo cache restoration failed; clearing incomplete task archives."
  rm -rf .turbo/cache
fi

started=$SECONDS
pnpm install --frozen-lockfile --prefer-offline \
  --fetch-timeout=30000 "$@"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  echo "Dependency installation: $((SECONDS - started))s; pnpm restore: ${PNPM_CACHE_RESTORE_OUTCOME:-not requested}; Turbo restore: ${TURBO_CACHE_RESTORE_OUTCOME:-not requested}." >> "$GITHUB_STEP_SUMMARY"
fi

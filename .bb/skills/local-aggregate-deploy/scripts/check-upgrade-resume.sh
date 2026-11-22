#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

case "${1:-}:$#" in
  check:1|verify:2) ;;
  *) fail 'Usage: check-upgrade-resume.sh check | verify <prepared-batch.json>' ;;
esac

root=$(bb plugin list --json | jq -er '
  .plugins[]
  | select(.id == "upgrade-resume" and .enabled and .status == "running")
  | select(any(.services[]; .name == "upgrade-resume" and .state == "running"))
  | .rootDir | strings | select(startswith("/"))
') || fail 'upgrade-resume and its background service must be running.'
manifest="$root/package.json"
[[ -f "$manifest" && -r "$manifest" ]] ||
  fail "upgrade-resume manifest is missing or unreadable: $manifest"
entry=$(jq -er '.bb.server | strings | select(length > 0)' "$manifest") ||
  fail "upgrade-resume has no server entry in $manifest"
[[ -f "$root/$entry" && -r "$root/$entry" ]] ||
  fail "upgrade-resume server entry is missing or unreadable: $root/$entry"

if [[ "$1" == check ]]; then
  printf 'upgrade-resume running; source readable: %s\n' "$root"
else
  expected=$(jq -er '.id | strings | select(length > 0)' "$2") ||
    fail "Cannot read the prepared upgrade-resume batch ID from $2"
  bb upgrade-resume status --json | jq -e --arg expected "$expected" 'select(.id == $expected)' ||
    fail "Cannot read the expected upgrade-resume batch: $expected"
fi

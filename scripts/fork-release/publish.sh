#!/usr/bin/env bash
set -euo pipefail

: "${GH_REPO:?}" "${RELEASE_TAG:?}" "${GITHUB_SHA:?}"
remote_source="$(git ls-remote "https://github.com/${GH_REPO}.git" "refs/tags/${RELEASE_TAG}" "refs/tags/${RELEASE_TAG}^{}" | awk '/\^\{\}$/ { peeled=$1; next } { target=$1 } END { print peeled ? peeled : target }')"
test "$remote_source" = "$GITHUB_SHA"
node scripts/fork-release/verify-sdk.mjs release "$RELEASE_TAG" "$GITHUB_SHA"
cd release

archive="bb-${RELEASE_TAG}-linux-x64.tar.gz"
test -s "$archive"
test -s "$archive.sha256"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum --check "$archive.sha256"
else
  shasum -a 256 --check "$archive.sha256"
fi
assets=("$archive" "$archive.sha256")

sdk="bb-plugin-sdk-${RELEASE_TAG}"
assets+=("$sdk.tgz" "$sdk.tgz.sha256" "$sdk.json")

cat > release-notes.md <<EOF
Prebuilt BB fork aggregate from commit ${GITHUB_SHA}.

The universal Plugin SDK npm tarball and provenance JSON come from the same commit. They are for plugin development; SDK package names and versions retain their upstream values.

This release targets the self-hosted Linux x64 deployment. Download its linux-x64 archive. Verify its accompanying SHA-256 checksum, extract it, then run bin/bb-app or bin/bb --help inside the extracted directory.

Node, the web app, server, host daemon, CLI and built-in plugins are included. No source checkout, aggregation, rebase, pnpm or compilation is needed on the target machine.

Linux requires glibc 2.35 or newer (Ubuntu 22.04 or equivalent). Runtime and data migration behavior follows the upstream BB version; keep the existing data directory and stop the old instance before starting the replacement.

[Installation and release instructions](https://github.com/${GH_REPO}/blob/${RELEASE_TAG}/docs/fork-maintenance.md)
EOF

if gh release view "$RELEASE_TAG" --json isDraft,body,assets > release-state.json; then
  if node --input-type=module -e 'import fs from "node:fs"; process.exit(JSON.parse(fs.readFileSync("release-state.json")).isDraft ? 1 : 0)'; then
    node --input-type=module - "$GITHUB_SHA" "${assets[@]}" <<'NODE'
import fs from "node:fs";
const release = JSON.parse(fs.readFileSync("release-state.json"));
const [source, ...expected] = process.argv.slice(2);
if (!release.body.includes(`commit ${source}.`) || expected.some(name => !release.assets.some(asset => asset.name === name && asset.size > 0))) {
  throw new Error("Published release does not match the source or expected assets");
}
NODE
    echo "Release $RELEASE_TAG is already published; keeping its existing assets."
    exit 0
  fi
  gh release edit "$RELEASE_TAG" --title "BB fork $RELEASE_TAG" --notes-file release-notes.md
else
  gh release create "$RELEASE_TAG" --verify-tag --draft --title "BB fork $RELEASE_TAG" --notes-file release-notes.md
fi

gh release upload "$RELEASE_TAG" "${assets[@]}" --clobber
gh release edit "$RELEASE_TAG" --draft=false --latest=false
gh release view "$RELEASE_TAG" --json url --jq .url

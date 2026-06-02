#!/usr/bin/env bash
set -euo pipefail

# Packages a Chrome Web Store–ready ZIP from `extension/dist`.
#
# Usage:
#   SHORTLISTR_API_BASE_URL="https://your-api.example.com" bash extension/scripts/package-release.sh
#   bash extension/scripts/package-release.sh https://your-api.example.com
#
# Output:
#   ./shortlistr-extension.zip  (manifest.json at ZIP root)

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
EXT_DIR="${ROOT_DIR}/extension"
DIST_DIR="${EXT_DIR}/dist"

API_BASE_URL="${1:-${SHORTLISTR_API_BASE_URL:-}}"
if [[ -z "${API_BASE_URL}" ]]; then
  echo "Error: missing API base URL." >&2
  echo "Provide it as an arg or env var:" >&2
  echo "  SHORTLISTR_API_BASE_URL=\"https://your-api.example.com\" bash extension/scripts/package-release.sh" >&2
  echo "  bash extension/scripts/package-release.sh https://your-api.example.com" >&2
  exit 1
fi

if [[ "${API_BASE_URL}" != https://* ]]; then
  echo "Error: API base URL must be https for Chrome Web Store builds (got: ${API_BASE_URL})." >&2
  exit 1
fi

if [[ "${API_BASE_URL}" == *localhost* || "${API_BASE_URL}" == *127.0.0.1* ]]; then
  echo "Error: API base URL must not be localhost for store builds." >&2
  exit 1
fi

echo "[release] Building extension…"
(cd "${ROOT_DIR}" && npm --workspace extension run build)

SW_FILE="${DIST_DIR}/src/background/service_worker.js"
MANIFEST_FILE="${DIST_DIR}/manifest.json"

if [[ ! -f "${SW_FILE}" ]]; then
  echo "Error: missing ${SW_FILE}. Did the build succeed?" >&2
  exit 1
fi
if [[ ! -f "${MANIFEST_FILE}" ]]; then
  echo "Error: missing ${MANIFEST_FILE}. Did the build succeed?" >&2
  exit 1
fi

echo "[release] Patching API base URL + manifest host permissions…"
API_BASE_URL="${API_BASE_URL}" node <<'NODE'
const fs = require("fs");
const path = require("path");

const apiBase = String(process.env.API_BASE_URL || "").trim();
if (!apiBase) throw new Error("Missing API_BASE_URL");

const distDir = path.join(process.cwd(), "extension", "dist");
const swPath = path.join(distDir, "src", "background", "service_worker.js");
const manifestPath = path.join(distDir, "manifest.json");

const sw = fs.readFileSync(swPath, "utf8");
let nextSw = sw.replace(
  /const\s+FIXED_API_BASE_URL\s*=\s*"[^"]*";/,
  `const FIXED_API_BASE_URL = "${apiBase}";`
);
// Remove dev-only localhost references from comments for store builds.
nextSw = nextSw.replace(/^[^\S\r\n]*\/\/\s*For local dev,[^\n]*\n/gm, "");
if (nextSw === sw) throw new Error("Failed to patch FIXED_API_BASE_URL in service worker.");
fs.writeFileSync(swPath, nextSw, "utf8");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const u = new URL(apiBase);
const apiOriginPattern = `${u.protocol}//${u.hostname}/*`;

const host = Array.isArray(manifest.host_permissions) ? manifest.host_permissions.slice() : [];
const filteredHost = host.filter(
  (p) => !/^http:\/\/localhost\//i.test(p) && !/^http:\/\/127\.0\.0\.1\//i.test(p)
);
if (!filteredHost.includes(apiOriginPattern)) filteredHost.push(apiOriginPattern);
manifest.host_permissions = filteredHost;

manifest.optional_host_permissions = [];

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
NODE

echo "[release] Sanity checks…"
if rg -n "localhost:8787|http://localhost|127\\.0\\.0\\.1" "${DIST_DIR}" >/dev/null; then
  echo "Error: found localhost references in dist. Refusing to ZIP." >&2
  rg -n "localhost:8787|http://localhost|127\\.0\\.0\\.1" "${DIST_DIR}" | head -n 20 >&2 || true
  exit 1
fi
if rg -n "sk-[A-Za-z0-9_-]{10,}" "${DIST_DIR}" >/dev/null; then
  echo "Error: found something that looks like an API key in dist. Refusing to ZIP." >&2
  rg -n "sk-[A-Za-z0-9_-]{10,}" "${DIST_DIR}" | head -n 20 >&2 || true
  exit 1
fi

OUT_ZIP="${ROOT_DIR}/shortlistr-extension.zip"
rm -f "${OUT_ZIP}"

echo "[release] Creating ZIP: ${OUT_ZIP}"
(cd "${DIST_DIR}" && zip -r -q "${OUT_ZIP}" . -x "*.DS_Store" "__MACOSX/*")

echo "[release] Done."
echo "Upload this ZIP to the Chrome Web Store:"
echo "  ${OUT_ZIP}"

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

SRC_DEFAULT="${EXT_DIR}/assets/icon-source.png"
OUT_DIR="${EXT_DIR}/public/assets/icons"

if ! command -v sips >/dev/null 2>&1; then
  echo "Error: 'sips' is required to generate icons (macOS built-in)." >&2
  echo "Tip: On non-macOS, generate PNGs at 16/32/48/128 and replace files in:" >&2
  echo "  ${OUT_DIR}" >&2
  exit 1
fi

pick_best_source() {
  local best=""
  local best_area=0
  local file w h area

  while IFS= read -r -d '' file; do
    w="$(sips -g pixelWidth "${file}" 2>/dev/null | awk '/pixelWidth/ {print $2}' | tail -n 1 || true)"
    h="$(sips -g pixelHeight "${file}" 2>/dev/null | awk '/pixelHeight/ {print $2}' | tail -n 1 || true)"
    if [[ -z "${w}" || -z "${h}" ]]; then
      continue
    fi
    area=$((w * h))
    if (( area > best_area )); then
      best="${file}"
      best_area="${area}"
    fi
  done < <(find "${EXT_DIR}/assets" -maxdepth 1 -type f -iname "*.png" -print0 2>/dev/null || true)

  if [[ -n "${best}" ]]; then
    echo "${best}"
  fi
}

SRC=""
if [[ $# -ge 1 ]]; then
  SRC="${1}"
elif [[ -f "${SRC_DEFAULT}" ]]; then
  SRC="${SRC_DEFAULT}"
else
  SRC="$(pick_best_source || true)"
fi

if [[ ! -f "${SRC}" ]]; then
  echo "Error: source icon not found:" >&2
  if [[ -n "${SRC}" ]]; then
    echo "  ${SRC}" >&2
  else
    echo "  (none)" >&2
  fi
  echo "" >&2
  echo "Found these nearby PNGs (maybe pick one and pass it in):" >&2
  find "${EXT_DIR}" -maxdepth 4 -type f \( -iname "*icon*source*.png" -o -iname "*icon*.png" \) 2>/dev/null | head -n 15 >&2 || true
  echo "" >&2
  echo "Save a square PNG (e.g. 512x512) there, or pass a filepath:" >&2
  echo "  npm --workspace extension run generate:icons -- /path/to/icon.png" >&2
  exit 1
fi

w="$(sips -g pixelWidth "${SRC}" 2>/dev/null | awk '/pixelWidth/ {print $2}' | tail -n 1 || true)"
h="$(sips -g pixelHeight "${SRC}" 2>/dev/null | awk '/pixelHeight/ {print $2}' | tail -n 1 || true)"
if [[ -z "${w}" || -z "${h}" ]]; then
  echo "Error: could not read dimensions for: ${SRC}" >&2
  exit 1
fi
if [[ "${w}" != "${h}" ]]; then
  echo "Error: source icon must be square (got ${w}x${h}): ${SRC}" >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"

for size in 16 32 48 128; do
  sips -z "${size}" "${size}" "${SRC}" --out "${OUT_DIR}/icon${size}.png" >/dev/null
done

echo "Generated:"
ls -lh "${OUT_DIR}/icon16.png" "${OUT_DIR}/icon32.png" "${OUT_DIR}/icon48.png" "${OUT_DIR}/icon128.png"

# If you're loading the unpacked extension from `extension/dist`, also update those icons so Chrome
# reflects changes immediately without requiring a rebuild.
DIST_OUT_DIR="${EXT_DIR}/dist/assets/icons"
if [[ -d "${DIST_OUT_DIR}" ]]; then
  mkdir -p "${DIST_OUT_DIR}"
  cp -f "${OUT_DIR}/icon16.png" "${OUT_DIR}/icon32.png" "${OUT_DIR}/icon48.png" "${OUT_DIR}/icon128.png" "${DIST_OUT_DIR}/"
  echo ""
  echo "Also updated:"
  ls -lh "${DIST_OUT_DIR}/icon16.png" "${DIST_OUT_DIR}/icon32.png" "${DIST_OUT_DIR}/icon48.png" "${DIST_OUT_DIR}/icon128.png"
fi

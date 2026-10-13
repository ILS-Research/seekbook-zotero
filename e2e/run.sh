#!/usr/bin/env bash
# E2E tests: builds the E2E variant of SeekBook (in the build container), then
# runs it in a real Zotero under Xvfb against a mock embedding server. Headless, Docker only.
# Output (results.json, zotero.log, screenshots) lands in e2e/out/.
set -euo pipefail
cd "$(dirname "$0")/.."

# ZOTERO_VERSION: default = current release; "all" = newest build of every major (7 … current), one run each.
if [ "${ZOTERO_VERSION:-}" = all ]; then
  rc=0
  for v in $(e2e/zotero-versions.sh); do ZOTERO_VERSION=$v "$0" "$@" || rc=1; done
  exit $rc
fi
ZOTERO_VERSION=${ZOTERO_VERSION:-$(e2e/zotero-versions.sh latest)}

# Full output of every run goes to logs/e2e.log (line-buffered via tee),
# so a long build can be followed with `tail -f logs/e2e.log`.
mkdir -p logs
exec > >(tee logs/e2e.log) 2>&1
echo "== $(date -Is) $0 $*"

DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then DOCKER=(sudo docker); fi

./build.sh e2e
"${DOCKER[@]}" build --progress=plain ${ZOTERO_VERSION:+--build-arg ZOTERO_VERSION="$ZOTERO_VERSION"} -t seekbook-e2e:latest e2e/
mkdir -p e2e/out test/assets

# Optional: the real ZotSeek ILS fork for the local-mode scenario, e.g.
#   E2E_ZOTSEEK_XPI=../zotero_selfhost_src/data/downloads/zotseek/zotseek-1.22.4.9-ils.xpi ./e2e/run.sh
EXTRA=()
[ -n "${E2E_ZOTSEEK_XPI:-}" ] && EXTRA+=(-v "$(realpath "$E2E_ZOTSEEK_XPI")":/zotseek.xpi:ro)

"${DOCKER[@]}" run --rm -u "$(id -u):$(id -g)" "${EXTRA[@]}" \
  -v "$PWD/dist":/dist:ro -v "$PWD/e2e/out":/out \
  -v "$PWD/test/assets":/assets:ro \
  -e E2E_TIMEOUT="${E2E_TIMEOUT:-600}" \
  seekbook-e2e:latest

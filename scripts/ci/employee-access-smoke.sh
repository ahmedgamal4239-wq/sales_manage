#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?The smoke check requires its disposable PostgreSQL database}"

api_port="${SMOKE_API_PORT:-8080}"
web_port="${SMOKE_WEB_PORT:-4173}"
expo_port="${SMOKE_EXPO_PORT:-22356}"
proxy_port="${SMOKE_PROXY_PORT:-8443}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
temp_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
work_dir="$(mktemp -d "${temp_root%/}/employee-access-smoke.XXXXXX")"
mkdir -p "$work_dir/logs"
declare -a process_groups=()

cleanup() {
  status=$?
  trap - EXIT
  for process_group in "${process_groups[@]}"; do
    kill -- "-${process_group}" 2>/dev/null || true
  done
  for process_group in "${process_groups[@]}"; do
    wait "$process_group" 2>/dev/null || true
  done
  if (( status != 0 )); then
    for log in "$work_dir"/logs/*.log; do
      [[ -f "$log" ]] || continue
      echo "--- ${log##*/} (last 60 lines) ---"
      tail -n 60 "$log"
    done
  fi
  rm -rf "$work_dir"
  exit "$status"
}
trap cleanup EXIT

cd "$repo_root"

for port in "$api_port" "$web_port" "$expo_port" "$proxy_port"; do
  node -e '
    const server = require("node:net").createServer();
    server.once("error", error => { console.error(`Smoke-test port ${process.argv[1]} unavailable: ${error.message}`); process.exitCode = 1; });
    server.listen(Number(process.argv[1]), "127.0.0.1", () => server.close());
  ' "$port"
done

echo "Applying schema to the disposable employee-access database..."
pnpm --filter @workspace/db run push >"$work_dir/logs/schema.log" 2>&1 || {
  cat "$work_dir/logs/schema.log"
  exit 1
}

openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -keyout "$work_dir/localhost.key" -out "$work_dir/localhost.crt" \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  >/dev/null 2>&1

start_service() {
  local log_name="$1"
  shift
  setsid "$@" >"$work_dir/logs/${log_name}.log" 2>&1 &
  process_groups+=("$!")
}

start_service api env \
  DATABASE_URL="$DATABASE_URL" SESSION_SECRET="${SESSION_SECRET:-employee-access-ci-only-session-secret}" \
  PORT="$api_port" pnpm --filter @workspace/api-server run dev

start_service web env \
  BASE_PATH=/sales-operations/ PORT="$web_port" \
  pnpm --filter @workspace/sales-operations run dev

# Keep Expo web setup enabled; headless mode otherwise disables it by default.
start_service expo env \
  BROWSER=none CI=true EXPO_UNSTABLE_HEADLESS=true EXPO_NO_WEB_SETUP=false EXPO_PUBLIC_DOMAIN="localhost:$proxy_port" EXPO_PUBLIC_REPL_ID=employee-access-smoke \
  REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1 PORT="$expo_port" \
  pnpm --filter @workspace/sales-operations-mobile exec expo start --web --lan --port "$expo_port"

start_service proxy env \
  SMOKE_TLS_KEY="$work_dir/localhost.key" SMOKE_TLS_CERT="$work_dir/localhost.crt" \
  SMOKE_API_PORT="$api_port" SMOKE_WEB_PORT="$web_port" SMOKE_EXPO_PORT="$expo_port" SMOKE_PROXY_PORT="$proxy_port" \
  node scripts/ci/smoke-https-proxy.mjs

wait_for_http() {
  local name="$1"
  local url="$2"
  local -a curl_options=()
  [[ "$url" == https://localhost:"$proxy_port"/* ]] && curl_options=(-k)
  for _ in $(seq 1 90); do
    if curl "${curl_options[@]}" --fail --silent --show-error --max-time 2 "$url" >/dev/null 2>&1; then
      echo "$name is ready."
      return 0
    fi
    sleep 2
  done
  echo "Timed out waiting for $name at $url." >&2
  echo "::error title=Smoke service readiness::$name did not return HTTP 200 at $url."
  if [[ "$name" == "Expo web app" ]]; then
    for host in 127.0.0.1 localhost; do
      code="$(curl --silent --output /dev/null --max-time 5 --write-out "%{http_code}" "http://$host:$expo_port/" 2>/dev/null || true)"
      echo "::error title=Expo HTTP probe::$host:$expo_port returned HTTP ${code:-000}."
    done
  fi
  return 1
}

wait_for_http "API" "http://127.0.0.1:$api_port/api/healthz"
wait_for_http "web app" "http://127.0.0.1:$web_port/sales-operations/"
wait_for_http "Expo web app" "http://127.0.0.1:$expo_port/"
wait_for_http "HTTPS test proxy" "https://localhost:$proxy_port/api/healthz"

echo "Running browser smoke test with throwaway accounts and no retained browser artifacts..."
if ! SMOKE_ORIGIN="https://localhost:$proxy_port" \
  SMOKE_API_ORIGIN="http://127.0.0.1:$api_port" \
  SMOKE_MOBILE_URL="https://localhost:$proxy_port/" \
  pnpm --filter @workspace/scripts run verify-employee-browser; then
  echo "::error title=Employee browser check::Browser smoke test failed after services became ready."
  exit 1
fi
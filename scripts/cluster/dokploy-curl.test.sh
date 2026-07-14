#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
subject="${script_dir}/dokploy-curl.sh"
test_root="$(mktemp -d)"
mock_bin="${test_root}/bin"
mkdir -p "$mock_bin"
trap 'rm -rf "$test_root"' EXIT

cat > "${mock_bin}/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail

: "${DOKPLOY_CURL_TEST_STATE:?}"
: "${DOKPLOY_CURL_EXPECTED_TOKEN:?}"

header_file=''
previous=''
for argument in "$@"; do
  if [ "$argument" = "$DOKPLOY_CURL_EXPECTED_TOKEN" ] \
    || [[ "$argument" == *"$DOKPLOY_CURL_EXPECTED_TOKEN"* ]]; then
    echo 'token leaked into curl argument vector' >&2
    exit 90
  fi
  if [ "$previous" = '-H' ] && [[ "$argument" == @* ]]; then
    header_file="${argument#@}"
  fi
  previous="$argument"
done
if [ -z "$header_file" ] || [ ! -f "$header_file" ]; then
  echo 'curl did not receive a readable header file' >&2
  exit 91
fi
mode="$(stat -c '%a' "$header_file" 2>/dev/null || stat -f '%Lp' "$header_file")"
if [ "$mode" != 600 ]; then
  echo "header file mode was ${mode}" >&2
  exit 92
fi
if [ "$(cat "$header_file")" != "x-api-key: ${DOKPLOY_CURL_EXPECTED_TOKEN}" ]; then
  echo 'header file content was not exact' >&2
  exit 93
fi
if [ -n "${DOKPLOY_TOKEN:-}" ]; then
  echo 'curl inherited DOKPLOY_TOKEN' >&2
  exit 94
fi
printf '%s\n' "$header_file" > "$DOKPLOY_CURL_TEST_STATE"
cat > "${DOKPLOY_CURL_TEST_STATE}.stdin"
if [ -n "${DOKPLOY_CURL_TEST_SIGNAL:-}" ]; then
  kill -s "$DOKPLOY_CURL_TEST_SIGNAL" "$PPID"
  exit 0
fi
printf '%s' 'mock-response'
exit "${DOKPLOY_CURL_TEST_EXIT:-0}"
MOCK
chmod 0700 "${mock_bin}/curl"

token='dokploy-test-token-never-log'
state="${test_root}/state"
output="$({
  printf '%s' 'request-body' \
    | PATH="${mock_bin}:$PATH" \
      RUNNER_TEMP="$test_root" \
      DOKPLOY_TOKEN="$token" \
      DOKPLOY_CURL_EXPECTED_TOKEN="$token" \
      DOKPLOY_CURL_TEST_STATE="$state" \
      "$subject" -sS -X POST https://dokploy.example.test/api/test --data @-
} 2>&1)"
if [ "$output" != mock-response ]; then
  echo 'wrapper did not preserve curl output' >&2
  exit 1
fi
header_file="$(cat "$state")"
if [ -e "$header_file" ]; then
  echo 'wrapper did not remove the header file after success' >&2
  exit 1
fi
if [ "$(cat "${state}.stdin")" != request-body ]; then
  echo 'wrapper did not preserve curl standard input' >&2
  exit 1
fi
if [[ "$output" == *"$token"* ]] || [[ "$output" == *"$header_file"* ]]; then
  echo 'wrapper logged a secret or header path' >&2
  exit 1
fi
echo 'PASS success path hides argv secret, preserves I/O, and removes header'

failure_state="${test_root}/failure-state"
failure_output=''
failure_status=0
failure_output="$({
  PATH="${mock_bin}:$PATH" \
    RUNNER_TEMP="$test_root" \
    DOKPLOY_TOKEN="$token" \
    DOKPLOY_CURL_EXPECTED_TOKEN="$token" \
    DOKPLOY_CURL_TEST_STATE="$failure_state" \
    DOKPLOY_CURL_TEST_EXIT=22 \
    "$subject" -sS https://dokploy.example.test/api/failure </dev/null
} 2>&1)" || failure_status=$?
if [ "$failure_status" -ne 22 ]; then
  echo "wrapper did not preserve curl failure status (${failure_status})" >&2
  exit 1
fi
failure_header_file="$(cat "$failure_state")"
if [ -e "$failure_header_file" ]; then
  echo 'wrapper did not remove the header file after failure' >&2
  exit 1
fi
if [[ "$failure_output" == *"$token"* ]] || [[ "$failure_output" == *"$failure_header_file"* ]]; then
  echo 'failure path logged a secret or header path' >&2
  exit 1
fi
echo 'PASS failure path preserves status and removes header'

signal_state="${test_root}/signal-state"
signal_output=''
signal_status=0
signal_output="$({
  PATH="${mock_bin}:$PATH" \
    RUNNER_TEMP="$test_root" \
    DOKPLOY_TOKEN="$token" \
    DOKPLOY_CURL_EXPECTED_TOKEN="$token" \
    DOKPLOY_CURL_TEST_STATE="$signal_state" \
    DOKPLOY_CURL_TEST_SIGNAL=TERM \
    "$subject" -sS https://dokploy.example.test/api/interrupted </dev/null
} 2>&1)" || signal_status=$?
if [ "$signal_status" -ne 143 ]; then
  echo "wrapper did not preserve the TERM exit status (${signal_status})" >&2
  exit 1
fi
signal_header_file="$(cat "$signal_state")"
if [ -e "$signal_header_file" ]; then
  echo 'wrapper did not remove the header file after interruption' >&2
  exit 1
fi
if [[ "$signal_output" == *"$token"* ]] || [[ "$signal_output" == *"$signal_header_file"* ]]; then
  echo 'interruption path logged a secret or header path' >&2
  exit 1
fi
echo 'PASS interruption path preserves signal status and removes header'

newline_status=0
PATH="${mock_bin}:$PATH" \
  RUNNER_TEMP="$test_root" \
  DOKPLOY_TOKEN=$'invalid\ntoken' \
  DOKPLOY_CURL_EXPECTED_TOKEN="$token" \
  DOKPLOY_CURL_TEST_STATE="${test_root}/newline-state" \
  "$subject" https://dokploy.example.test/api/test >/dev/null 2>&1 \
  || newline_status=$?
if [ "$newline_status" -eq 0 ]; then
  echo 'wrapper accepted a header-injecting token' >&2
  exit 1
fi
echo 'PASS line-break token fails closed'

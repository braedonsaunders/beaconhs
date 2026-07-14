#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
subject="${script_dir}/require-current-main.sh"
test_root="$(mktemp -d)"
mock_bin="${test_root}/bin"
mkdir -p "$mock_bin"
trap 'rm -rf "$test_root"' EXIT

cat > "${mock_bin}/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail

: "${CURRENT_MAIN_TEST_STATE:?}"
: "${CURRENT_MAIN_EXPECTED_TOKEN:?}"
: "${CURRENT_MAIN_RESPONSE_JSON:?}"

header_file=''
response_file=''
previous=''
for argument in "$@"; do
  if [ "$argument" = '--retry-all-errors' ]; then
    echo 'curl: option --retry-all-errors: is unknown' >&2
    exit 96
  fi
  if [[ "$argument" == *"$CURRENT_MAIN_EXPECTED_TOKEN"* ]]; then
    echo 'token leaked into curl argument vector' >&2
    exit 90
  fi
  if [ "$previous" = '-H' ] && [[ "$argument" == @* ]]; then
    header_file="${argument#@}"
  elif [ "$previous" = '-o' ]; then
    response_file="$argument"
  fi
  previous="$argument"
done
if [ -z "$header_file" ] || [ ! -f "$header_file" ]; then
  echo 'curl did not receive a readable header file' >&2
  exit 91
fi
if [ -z "$response_file" ] || [ ! -f "$response_file" ]; then
  echo 'curl did not receive a readable response file' >&2
  exit 92
fi
header_mode="$(stat -c '%a' "$header_file" 2>/dev/null || stat -f '%Lp' "$header_file")"
response_mode="$(stat -c '%a' "$response_file" 2>/dev/null || stat -f '%Lp' "$response_file")"
if [ "$header_mode" != 600 ] || [ "$response_mode" != 600 ]; then
  echo "temporary file modes were header=${header_mode}, response=${response_mode}" >&2
  exit 93
fi
if [ "$(cat "$header_file")" != "authorization: Bearer ${CURRENT_MAIN_EXPECTED_TOKEN}" ]; then
  echo 'authorization header content was not exact' >&2
  exit 94
fi
if [ "${GITHUB_TOKEN+x}" = x ]; then
  echo 'curl inherited GITHUB_TOKEN' >&2
  exit 95
fi
printf '%s\t%s\n' "$header_file" "$response_file" > "$CURRENT_MAIN_TEST_STATE"
printf '%s\n' "$CURRENT_MAIN_RESPONSE_JSON" > "$response_file"
if [ -n "${CURRENT_MAIN_TEST_SIGNAL:-}" ]; then
  kill -s "$CURRENT_MAIN_TEST_SIGNAL" "$PPID"
  exit 0
fi
exit "${CURRENT_MAIN_CURL_EXIT:-0}"
MOCK
chmod 0700 "${mock_bin}/curl"

sha='1111111111111111111111111111111111111111'
token='github-test-token-never-log'
valid_payload="{\"object\":{\"sha\":\"${sha}\"}}"

run_subject() {
  state="$1"
  shift
  PATH="${mock_bin}:$PATH" \
    RUNNER_TEMP="$test_root" \
    GITHUB_API_URL='https://api.github.example.test' \
    GITHUB_REPOSITORY='example/beaconhs' \
    GITHUB_REF='refs/heads/main' \
    GITHUB_SHA="$sha" \
    GITHUB_TOKEN="$token" \
    CURRENT_MAIN_EXPECTED_TOKEN="$token" \
    CURRENT_MAIN_RESPONSE_JSON="$valid_payload" \
    CURRENT_MAIN_TEST_STATE="$state" \
    "$@" \
    "$subject"
}

assert_temporary_files_removed() {
  state="$1"
  IFS=$'\t' read -r header_file response_file < "$state"
  if [ -e "$header_file" ] || [ -e "$response_file" ]; then
    echo 'main-tip check did not remove its temporary files' >&2
    exit 1
  fi
}

state="${test_root}/success-state"
output="$(run_subject "$state" env 2>&1)"
if [ "$output" != 'Verified that this workflow SHA is the current remote main tip' ]; then
  echo 'success output was not exact' >&2
  exit 1
fi
assert_temporary_files_removed "$state"
if [[ "$output" == *"$token"* ]]; then
  echo 'success path logged the token' >&2
  exit 1
fi
echo 'PASS success path hides token from argv/environment and removes temporary files'

state="${test_root}/curl-failure-state"
status=0
output="$(run_subject "$state" env CURRENT_MAIN_CURL_EXIT=22 2>&1)" || status=$?
if [ "$status" -ne 1 ]; then
  echo "curl failure did not fail closed (${status})" >&2
  exit 1
fi
assert_temporary_files_removed "$state"
grep -Fq 'Unable to resolve the current remote main tip' <<< "$output"
if [[ "$output" == *"$token"* ]]; then
  echo 'curl failure path logged the token' >&2
  exit 1
fi
echo 'PASS curl failure is generic, fails closed, and removes temporary files'

state="${test_root}/payload-failure-state"
status=0
output="$(
  run_subject "$state" env \
    CURRENT_MAIN_RESPONSE_JSON='{"object":{"sha":"not-a-sha"}}' 2>&1
)" || status=$?
if [ "$status" -ne 1 ]; then
  echo "invalid payload did not fail closed (${status})" >&2
  exit 1
fi
assert_temporary_files_removed "$state"
grep -Fq 'GitHub returned an invalid main-branch ref payload' <<< "$output"
if [[ "$output" == *"$token"* ]]; then
  echo 'invalid payload path logged the token' >&2
  exit 1
fi
echo 'PASS invalid API payload fails closed without leaking the token'

state="${test_root}/stale-state"
status=0
output="$(
  run_subject "$state" env \
    CURRENT_MAIN_RESPONSE_JSON='{"object":{"sha":"2222222222222222222222222222222222222222"}}' \
    2>&1
)" || status=$?
if [ "$status" -ne 1 ]; then
  echo "stale workflow SHA did not fail closed (${status})" >&2
  exit 1
fi
assert_temporary_files_removed "$state"
grep -Fq 'workflow SHA is no longer the current remote main tip' <<< "$output"
echo 'PASS stale workflow SHA fails closed'

state="${test_root}/signal-state"
status=0
output="$(run_subject "$state" env CURRENT_MAIN_TEST_SIGNAL=TERM 2>&1)" || status=$?
if [ "$status" -ne 143 ]; then
  echo "TERM did not preserve the conventional signal status (${status})" >&2
  exit 1
fi
assert_temporary_files_removed "$state"
if [[ "$output" == *"$token"* ]]; then
  echo 'signal path logged the token' >&2
  exit 1
fi
echo 'PASS interruption removes temporary files without leaking the token'

assert_line_break_token_rejected() {
  label="$1"
  injected_token="$2"
  state="${test_root}/${label}-state"
  status=0
  output="$(
    run_subject "$state" env "GITHUB_TOKEN=${injected_token}" 2>&1
  )" || status=$?
  if [ "$status" -eq 0 ] || [ -e "$state" ]; then
    echo "${label} token reached curl" >&2
    exit 1
  fi
  grep -Fq 'GITHUB_TOKEN must not contain a line break' <<< "$output"
  if [[ "$output" == *"$injected_token"* ]]; then
    echo "${label} failure logged the token" >&2
    exit 1
  fi
}

assert_line_break_token_rejected newline $'invalid\ntoken'
assert_line_break_token_rejected carriage-return $'invalid\rtoken'
echo 'PASS CR/LF tokens fail before curl without logging the token'

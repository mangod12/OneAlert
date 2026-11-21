#!/usr/bin/env bash
# Azure provisioning can outlive a previous CLI invocation. Retry only that conflict.
set -euo pipefail
if (( $# == 0 )); then
  echo 'A Container Apps command is required.' >&2
  exit 2
fi
output=$(mktemp)
trap 'rm -f "$output"' EXIT
for attempt in {1..7}; do
  if "$@" >"$output" 2>&1; then
    cat "$output"
    exit 0
  else
    status=$?
  fi
  cat "$output" >&2
  if ! grep -Fq 'ERROR: (ContainerAppOperationInProgress)' "$output" || (( attempt == 7 )); then
    exit "$status"
  fi
  echo "Azure provisioning is still active; retrying this command in 10 seconds ($attempt/7)." >&2
  sleep 10
done
